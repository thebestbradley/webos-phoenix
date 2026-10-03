// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
//
// KeePass databases: create, save, open, edit, search, TOTP fields, merge.
// fixtures/pykeepass-kdbx4.kdbx was written by another implementation
// (pykeepass 4.2, KDBX 4 with Argon2d; master password "fixture-master-pw";
// test data only).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as kdbxweb from "kdbxweb";
import {
    applyEdit, createDatabase, customFields, inRecycleBin, mergeRemote, newEntry, newGroup, openDatabase, otpOf, otpUriOf, recycleBin, remove,
    saveDatabase, search, setMasterPassword, text, VaultError, type EntryEdit,
} from "./kdbx";

// Light Argon2 for speed; the defaults are checked separately.
const FAST = { memoryKiB: 1024, iterations: 1, parallelism: 1 };
const edit = (o: Partial<EntryEdit>): EntryEdit => ({ title: "", username: "", password: "", url: "", notes: "", ...o });

function fixture(): ArrayBuffer {
    const b = readFileSync(join(__dirname, "fixtures", "pykeepass-kdbx4.kdbx"));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe("KDBX databases", () => {
    it("creates KDBX 4 with Argon2id and the strong defaults", () => {
        const db = createDatabase("Personal", "pw");
        expect(db.versionMajor).toBe(4);
        const p = db.header.kdfParameters!;
        expect(kdbxweb.ByteUtils.bytesToBase64(p.get("$UUID") as ArrayBuffer)).toBe(kdbxweb.Consts.KdfId.Argon2id);
        expect(Number(p.get("M"))).toBe(64 * 1024 * 1024);
        expect(Number(p.get("I"))).toBe(2);
        expect(p.get("P")).toBe(2);
        expect(recycleBin(db)).toBeDefined();
    });

    it("saves and opens again; the wrong password is refused", async () => {
        const db = createDatabase("Personal", "correct horse", FAST);
        const e = newEntry(db, db.getDefaultGroup());
        applyEdit(db, e, edit({ title: "Bank", username: "ada", password: "hunter2-MARKER", url: "https://bank.example" }), true);
        const bytes = await saveDatabase(db);
        // The password is not in the file in clear (nor is the title: the whole payload is encrypted).
        const raw = Buffer.from(bytes).toString("latin1");
        expect(raw).not.toContain("hunter2-MARKER");
        expect(raw).not.toContain("Bank");

        const again = await openDatabase(bytes, "correct horse");
        const [entry] = again.getDefaultGroup().entries;
        expect(text(entry, "Title")).toBe("Bank");
        expect(text(entry, "Password")).toBe("hunter2-MARKER");
        expect(entry.fields.get("Password")).toBeInstanceOf(kdbxweb.ProtectedValue);

        await expect(openDatabase(bytes, "wrong")).rejects.toMatchObject({ kind: "wrong-key" });
        await expect(openDatabase(new TextEncoder().encode("not a database").buffer as ArrayBuffer, "x")).rejects.toBeInstanceOf(VaultError);
    });

    it("opens a database another implementation wrote (Argon2d), with groups, custom and TOTP fields", async () => {
        const db = await openDatabase(fixture(), "fixture-master-pw");
        const root = db.getDefaultGroup();
        const email = root.groups.find((g) => g.name === "Email")!;
        expect(text(email.entries[0], "Password")).toBe("s3cret-Mail!");
        expect(text(email.entries[0], "Notes")).toBe("fixture note");

        const gh = root.entries.find((e) => text(e, "Title") === "GitHub")!;
        expect(otpOf(gh)).toMatchObject({ type: "totp", issuer: "GitHub", account: "ada", digits: 6, period: 30 });

        const legacy = root.entries.find((e) => text(e, "Title") === "Legacy TOTP")!;
        expect(otpOf(legacy)).toMatchObject({ type: "totp", digits: 8, period: 30 });
        expect(otpUriOf(legacy)).toMatch(/^otpauth:\/\/totp\/.*secret=JBSWY3DPEHPK3PXP/);
        expect(customFields(legacy)).toEqual([{ name: "PIN", protected: true }]);

        await expect(openDatabase(fixture(), "nope")).rejects.toMatchObject({ kind: "wrong-key" });
    });

    it("keeps legacy TOTP fields when an edit leaves the TOTP alone, and replaces them when it sets one", async () => {
        const db = await openDatabase(fixture(), "fixture-master-pw");
        const legacy = db.getDefaultGroup().entries.find((e) => text(e, "Title") === "Legacy TOTP")!;
        applyEdit(db, legacy, edit({ title: "Legacy TOTP", username: "bob", password: "new" }), false);
        expect(text(legacy, "TOTP Seed")).toBe("JBSWY3DPEHPK3PXP");
        applyEdit(db, legacy, edit({ title: "Legacy TOTP", password: "new", otp: "otpauth://totp/x?secret=JBSWY3DP" }), false);
        expect(text(legacy, "TOTP Seed")).toBe("");
        expect(text(legacy, "otp")).toBe("otpauth://totp/x?secret=JBSWY3DP");
        expect(text(legacy, "PIN")).toBe("4321");
    });

    it("keeps the previous version in the history on edit", () => {
        const db = createDatabase("H", "pw", FAST);
        const e = newEntry(db, db.getDefaultGroup());
        applyEdit(db, e, edit({ title: "A", password: "one" }), true);
        applyEdit(db, e, edit({ title: "A", password: "two" }), false);
        expect(e.history).toHaveLength(1);
        expect(text(e.history[0], "Password")).toBe("one");
    });

    it("searches titles, users, URLs, notes and tags, never passwords, and not the recycle bin", () => {
        const db = createDatabase("S", "pw", FAST);
        const work = newGroup(db, db.getDefaultGroup(), "Work");
        const a = newEntry(db, work);
        applyEdit(db, a, edit({ title: "Intranet", username: "ada", password: "zebra-secret", url: "https://intra.example", notes: "VPN first" }), true);
        const b = newEntry(db, db.getDefaultGroup());
        applyEdit(db, b, edit({ title: "Old intranet", password: "x" }), true);
        remove(db, b);
        expect(inRecycleBin(db, b)).toBe(true);
        expect(search(db, "intranet").map((e) => text(e, "Title"))).toEqual(["Intranet"]);
        expect(search(db, "vpn ADA")).toHaveLength(1);
        expect(search(db, "intra.example")).toHaveLength(1);
        expect(search(db, "zebra")).toHaveLength(0);
        expect(search(db, "  ")).toHaveLength(0);
    });

    it("deletes to the recycle bin, then for good", () => {
        const db = createDatabase("D", "pw", FAST);
        const e = newEntry(db, db.getDefaultGroup());
        applyEdit(db, e, edit({ title: "Gone" }), true);
        remove(db, e);
        expect(recycleBin(db)!.entries).toContain(e);
        remove(db, e);
        expect(recycleBin(db)!.entries).not.toContain(e);
        expect(db.deletedObjects.some((d) => d.uuid?.equals(e.uuid))).toBe(true);
    });

    it("merges a copy changed elsewhere: both sides' edits survive", async () => {
        const db = createDatabase("M", "pw", FAST);
        const e = newEntry(db, db.getDefaultGroup());
        applyEdit(db, e, edit({ title: "Shared", password: "v1" }), true);
        const base = await saveDatabase(db);

        const local = await openDatabase(base, "pw");
        const remote = await openDatabase(base, "pw");
        const r = newEntry(remote, remote.getDefaultGroup());
        applyEdit(remote, r, edit({ title: "Added on the laptop" }), true);
        const remoteBytes = await saveDatabase(remote);
        const l = newEntry(local, local.getDefaultGroup());
        applyEdit(local, l, edit({ title: "Added on the phone" }), true);

        mergeRemote(local, await openDatabase(remoteBytes, "pw"));
        const titles = local.getDefaultGroup().entries.map((x) => text(x, "Title")).sort();
        expect(titles).toEqual(["Added on the laptop", "Added on the phone", "Shared"]);
    });

    it("changes the master password", async () => {
        const db = createDatabase("C", "old", FAST);
        await setMasterPassword(db, "new");
        const bytes = await saveDatabase(db);
        await expect(openDatabase(bytes, "old")).rejects.toMatchObject({ kind: "wrong-key" });
        expect((await openDatabase(bytes, "new")).meta.name).toBe("C");
    });

    it("refuses a file whose key derivation asks for absurd memory", async () => {
        const db = createDatabase("X", "pw", { memoryKiB: 4 * 1024 * 1024, iterations: 1, parallelism: 1 });
        await expect(saveDatabase(db)).rejects.toMatchObject({ kind: "unsupported" });
    });
});
