// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// KeePass databases (KDBX 4, as KeePassXC and KeePassDX write them) through
// kdbxweb (MIT), with Argon2 from hash-wasm (MIT, WebAssembly).
//
// The database lives in memory only while it is unlocked. Passwords and
// other protected fields stay XOR-masked in kdbxweb's ProtectedValue until
// the moment they are shown or copied; nothing here writes plaintext
// anywhere, and errors never carry field values.

import * as kdbxweb from "kdbxweb";
import { argon2d, argon2id } from "hash-wasm";
import { buildOtpauth, parseOtpauth, parseSecret, validateOtp, type OtpAlgorithm, type OtpParams } from "@phoenix/secrets";

export type Kdbx = kdbxweb.Kdbx;
export type Entry = kdbxweb.KdbxEntry;
export type Group = kdbxweb.KdbxGroup;
export const { ProtectedValue } = kdbxweb;

// ---- Argon2 ------------------------------------------------------------------------

/** New databases: Argon2id, 64 MiB, 2 passes, 2 lanes (about KeePassXC's defaults; ~0.25 s on a desktop). */
export const NEW_KDF = { memoryKiB: 64 * 1024, iterations: 2, parallelism: 2 };
/** Refuse files that ask for more memory than a phone can give (a crafted file could hang the card). */
export const MAX_ARGON2_KIB = 1024 * 1024;

kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
    if (version !== 0x13) throw new kdbxweb.KdbxError(kdbxweb.Consts.ErrorCodes.Unsupported, "Argon2 version 1.0 is not supported");
    if (memory > MAX_ARGON2_KIB) throw new kdbxweb.KdbxError(kdbxweb.Consts.ErrorCodes.Unsupported, "The database's key derivation needs too much memory");
    const params = {
        password: new Uint8Array(password), salt: new Uint8Array(salt), parallelism, iterations, memorySize: memory,
        hashLength: length, outputType: "binary" as const,
    };
    const out = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? await argon2id(params) : await argon2d(params);
    params.password.fill(0);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
});

// ---- Opening, creating, saving ---------------------------------------------------------

export class VaultError extends Error {
    readonly kind: "wrong-key" | "not-kdbx" | "unsupported" | "corrupt";
    constructor(kind: VaultError["kind"], message: string) {
        super(message);
        this.name = "VaultError";
        this.kind = kind;
    }
}

function vaultError(e: unknown): VaultError {
    if (e instanceof VaultError) return e;
    const code = (e as { code?: string }).code;
    const E = kdbxweb.Consts.ErrorCodes;
    if (code === E.InvalidKey) return new VaultError("wrong-key", "Wrong master password (or the database also needs a key file, which Passwords does not support yet).");
    if (code === E.BadSignature) return new VaultError("not-kdbx", "This is not a KeePass database.");
    if (code === E.InvalidVersion || code === E.Unsupported || code === E.NotImplemented)
        return new VaultError("unsupported", "This database uses a format or setting Passwords does not support" +
            ((e as Error).message ? ` (${(e as Error).message.replace(/^[A-Za-z]+: /, "")}).` : "."));
    return new VaultError("corrupt", "The database could not be read: it may be damaged.");
}

export function credentials(password: string): kdbxweb.KdbxCredentials {
    return new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password));
}

/** Open a database. Throws VaultError. */
export async function openDatabase(data: ArrayBuffer, password: string): Promise<Kdbx> {
    try {
        return await kdbxweb.Kdbx.load(data, credentials(password));
    } catch (e) {
        throw vaultError(e);
    }
}

/** Open with credentials already made (merging the file after someone else changed it). */
export async function openWithCredentials(data: ArrayBuffer, creds: kdbxweb.KdbxCredentials): Promise<Kdbx> {
    try {
        return await kdbxweb.Kdbx.load(data, creds);
    } catch (e) {
        throw vaultError(e);
    }
}

/** A new KDBX 4 database with Argon2id and a recycle bin. */
export function createDatabase(name: string, password: string, kdf = NEW_KDF): Kdbx {
    const db = kdbxweb.Kdbx.create(credentials(password), name);
    db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
    const p = db.header.kdfParameters!;
    p.set("M", kdbxweb.VarDictionary.ValueType.UInt64, kdbxweb.Int64.from(kdf.memoryKiB * 1024));
    p.set("I", kdbxweb.VarDictionary.ValueType.UInt64, kdbxweb.Int64.from(kdf.iterations));
    p.set("P", kdbxweb.VarDictionary.ValueType.UInt32, kdf.parallelism);
    db.meta.recycleBinEnabled = true;
    db.createRecycleBin();
    return db;
}

export async function saveDatabase(db: Kdbx): Promise<ArrayBuffer> {
    try {
        return await db.save();
    } catch (e) {
        throw vaultError(e);
    }
}

/** Change the master password (takes effect on the next save). */
export async function setMasterPassword(db: Kdbx, password: string): Promise<void> {
    // The credentials hash their first password in the background
    // (KdbxCredentials' constructor); if that finished after this one, the
    // old password would win. Wait for it first.
    await db.credentials.ready;
    await db.credentials.setPassword(kdbxweb.ProtectedValue.fromString(password));
}

/**
 * Merge a newer copy of the file (changed by KeePassXC, KeePassDX or a sync
 * since we opened it) into ours: kdbxweb's CRDT merge keeps both sides'
 * edits, newest wins per entry, with history.
 */
export function mergeRemote(local: Kdbx, remote: Kdbx): void {
    local.merge(remote);
}

// ---- Fields ------------------------------------------------------------------------

export const STANDARD_FIELDS = ["Title", "UserName", "Password", "URL", "Notes"] as const;

export function text(entry: Entry, field: string): string {
    const v = entry.fields.get(field);
    if (v === undefined) return "";
    return typeof v === "string" ? v : v.getText();
}

export function isProtected(entry: Entry, field: string): boolean {
    return entry.fields.get(field) instanceof kdbxweb.ProtectedValue;
}

export function title(entry: Entry): string {
    return text(entry, "Title") || "(untitled)";
}

export interface CustomField {
    name: string;
    protected: boolean;
}

/** Fields other than the standard five and the TOTP ones. */
export function customFields(entry: Entry): CustomField[] {
    return [...entry.fields.keys()]
        .filter((k) => !(STANDARD_FIELDS as readonly string[]).includes(k) && !OTP_FIELDS.includes(k))
        .map((name) => ({ name, protected: isProtected(entry, name) }));
}

export interface EntryEdit {
    title: string;
    username: string;
    password: string;
    url: string;
    notes: string;
    /** otpauth:// URI, "" for none, undefined to leave the TOTP fields as they are. */
    otp?: string;
}

/** Apply an edit, keeping the previous version in the entry's history (as KeePass does). */
export function applyEdit(db: Kdbx, entry: Entry, edit: EntryEdit, isNew: boolean): void {
    if (!isNew) entry.pushHistory();
    const prot = db.meta.memoryProtection;
    const set = (field: string, value: string, protect: boolean | undefined) =>
        entry.fields.set(field, protect ? kdbxweb.ProtectedValue.fromString(value) : value);
    set("Title", edit.title, prot.title);
    set("UserName", edit.username, prot.userName);
    set("Password", edit.password, true);   // always protected, whatever the file says
    set("URL", edit.url, prot.url);
    set("Notes", edit.notes, prot.notes);
    if (edit.otp !== undefined) {
        for (const f of OTP_FIELDS) entry.fields.delete(f);
        if (edit.otp) entry.fields.set("otp", kdbxweb.ProtectedValue.fromString(edit.otp));
    }
    entry.times.update();
    if (!isNew) db.cleanup({ historyRules: true });
}

export function newEntry(db: Kdbx, group: Group): Entry {
    return db.createEntry(group);
}

export function newGroup(db: Kdbx, parent: Group, name: string): Group {
    return db.createGroup(parent, name);
}

export function recycleBin(db: Kdbx): Group | undefined {
    return db.meta.recycleBinUuid ? db.getGroup(db.meta.recycleBinUuid) : undefined;
}

export function inRecycleBin(db: Kdbx, item: Entry | Group): boolean {
    const bin = recycleBin(db);
    for (let g: Group | undefined = item.parentGroup; g; g = g.parentGroup) if (g === bin) return true;
    return item === bin;
}

/** Delete: to the recycle bin, or for good when it is already there (or there is none). */
export function remove(db: Kdbx, item: Entry | Group): void {
    if (inRecycleBin(db, item) || !db.meta.recycleBinEnabled) db.move(item, null);
    else db.remove(item);
}

// ---- Listing and search ----------------------------------------------------------------

export function sortedGroups(group: Group): Group[] {
    return [...group.groups].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export function sortedEntries(group: Group): Entry[] {
    return [...group.entries].sort((a, b) => title(a).localeCompare(title(b)));
}

/**
 * Entries whose title, user name, URL, notes or tags contain every word of
 * the query (case-insensitive). Never the password or protected custom
 * fields. The recycle bin is left out.
 */
export function search(db: Kdbx, query: string): Entry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out: Entry[] = [];
    const root = db.getDefaultGroup();
    const bin = recycleBin(db);
    const walk = (g: Group) => {
        if (g === bin || g.enableSearching === false) return;
        for (const e of g.entries) {
            const hay = [text(e, "Title"), text(e, "UserName"), text(e, "URL"), text(e, "Notes"), ...e.tags].join("\n").toLowerCase();
            if (words.every((w) => hay.includes(w))) out.push(e);
        }
        for (const sub of g.groups) walk(sub);
    };
    walk(root);
    return out.sort((a, b) => title(a).localeCompare(title(b)));
}

/** "Root / Email / Work" */
export function groupPath(group: Group | undefined): string[] {
    const names: string[] = [];
    for (let g = group; g; g = g.parentGroup) names.unshift(g.name ?? "");
    return names;
}

// ---- TOTP fields ------------------------------------------------------------------------
//
// KeePassXC 2.7+ and KeePassDX store an otpauth:// URI in the "otp" field.
// Older KeePassXC: "TOTP Seed" (base32) and "TOTP Settings" ("30;6", "30;8",
// "30;S" for Steam). KeeOtp and KeePassDX also read "otp" as
// "key=BASE32&step=30&size=6&otpHashMode=sha256".

export const OTP_FIELDS = ["otp", "TOTP Seed", "TOTP Settings"];

export function otpOf(entry: Entry): OtpParams | null {
    const otp = text(entry, "otp").trim();
    try {
        if (otp.startsWith("otpauth://")) return parseOtpauth(otp);
        if (otp) {
            const q = new URLSearchParams(otp);
            const key = q.get("key");
            if (!key) return null;
            const hash = (q.get("otpHashMode") || "sha1").toUpperCase() as OtpAlgorithm;
            return validateOtp({
                type: "totp", secret: parseSecret(key), algorithm: hash, digits: Number(q.get("size") || 6), period: Number(q.get("step") || 30),
                counter: 0, issuer: text(entry, "Title"), account: text(entry, "UserName"),
            });
        }
        const seed = text(entry, "TOTP Seed").trim();
        if (seed) {
            const [step, size] = (text(entry, "TOTP Settings") || "30;6").split(";");
            if (size === "S") return null;   // Steam's own alphabet: not supported
            return validateOtp({
                type: "totp", secret: parseSecret(seed), algorithm: "SHA1", digits: Number(size || 6), period: Number(step || 30),
                counter: 0, issuer: text(entry, "Title"), account: text(entry, "UserName"),
            });
        }
    } catch {
        return null;
    }
    return null;
}

/** The TOTP setting as the editor shows it: an otpauth:// URI (older formats converted), or "". */
export function otpUriOf(entry: Entry): string {
    const otp = text(entry, "otp").trim();
    if (otp.startsWith("otpauth://")) return otp;
    const p = otpOf(entry);
    return p ? buildOtpauth(p) : "";
}
