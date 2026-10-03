// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Authenticator's vault: the one-time code secrets, encrypted at rest.
//
//   data       AES-256-GCM with a random data key (DK); the plaintext is a
//              JSON list of tokens with base32 secrets
//   data key   wrapped (AES-GCM) with a key derived from the device passcode
//              (PBKDF2-SHA256, 600 000 iterations, random salt)
//
// This is the stand-in for the Phoenix key store the design calls for
// (docs/SYNERGY.md 2.9, docs/AI-AND-MCP.md "API keys":
// org.webosphoenix.service.keystore). Until that service exists on the
// device, the app wraps the data key itself, and the record is kept in the
// page's localStorage (on a device WebAppMgr keeps it per app; in the
// simulator every app shares one origin). The record holds only ciphertext,
// salt and parameters. See docs/SECURITY-APPS.md for what this does and does
// not protect: in short, a short PIN can be brute-forced offline by
// someone who copies the record, which the key store (a device-bound key,
// attempt limits) is meant to fix.
//
// While unlocked, each secret is imported once as a non-extractable HMAC
// CryptoKey (tokens), so the page computes codes without holding the
// secrets as strings. Changes (add, edit, delete, HOTP counter) decrypt the
// list briefly, change it and seal it again.

import {
    base32Encode, deriveKey, importOtpKey, newDataKey, newKdf, parseSecret, sealJson, SealError, unsealJson, unwrapKey, validateOtp, wrapKey,
    hotp, type KdfParams, type OtpAlgorithm, type OtpParams, type OtpType, type Sealed,
} from "@phoenix/secrets";

export const VAULT_KEY = "phoenix:org.webosphoenix.authenticator:vault";
const FORMAT = "phoenix-authenticator-vault";
const KEY_CONTEXT = "org.webosphoenix.authenticator/data-key/v1";
const DATA_CONTEXT = "org.webosphoenix.authenticator/tokens/v1";

/** What is sealed: one per token. */
export interface TokenRecord {
    id: string;
    type: OtpType;
    issuer: string;
    account: string;
    /** base32 */
    secret: string;
    algorithm: OtpAlgorithm;
    digits: number;
    period: number;
    counter: number;
    added: string;
}

/** What the page keeps while unlocked: no secret, a key that cannot be read back. */
export interface Token extends Omit<TokenRecord, "secret"> {
    key: CryptoKey;
}

interface VaultFile {
    format: typeof FORMAT;
    version: 1;
    kdf: KdfParams;
    wrappedKey: Sealed;
    data: Sealed;
}

export interface KeyValueStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export { SealError };

function readFile(store: KeyValueStore): VaultFile | null {
    const raw = store.getItem(VAULT_KEY);
    if (!raw) return null;
    try {
        const f = JSON.parse(raw) as VaultFile;
        if (f.format === FORMAT && f.version === 1 && f.kdf && f.wrappedKey && f.data) return f;
    } catch { /* fall through */ }
    throw new Error("The stored codes are damaged and cannot be read.");
}

export function newId(): string {
    const b = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function recordOf(p: OtpParams, id = newId()): TokenRecord {
    validateOtp(p);
    return {
        id, type: p.type, issuer: p.issuer.trim(), account: p.account.trim(), secret: base32Encode(p.secret), algorithm: p.algorithm,
        digits: p.digits, period: p.period, counter: p.counter, added: new Date().toISOString(),
    };
}

export function paramsOf(r: TokenRecord): OtpParams {
    return { type: r.type, issuer: r.issuer, account: r.account, secret: parseSecret(r.secret), algorithm: r.algorithm, digits: r.digits, period: r.period, counter: r.counter };
}

export function sameToken(a: TokenRecord, b: TokenRecord): boolean {
    return a.secret === b.secret && a.type === b.type && a.issuer === b.issuer && a.account === b.account;
}

export function sortTokens<T extends { issuer: string; account: string }>(list: T[]): T[] {
    return [...list].sort((a, b) => (a.issuer || a.account).localeCompare(b.issuer || b.account, undefined, { sensitivity: "base" })
        || a.account.localeCompare(b.account));
}

export class Vault {
    private store: KeyValueStore;
    private iterations: number | undefined;

    /** iterations: tests pass a smaller PBKDF2 count; the app uses the default. */
    constructor(store: KeyValueStore, iterations?: number) {
        this.store = store;
        this.iterations = iterations;
    }

    exists(): boolean {
        return readFile(this.store) !== null;
    }

    /** First use: a new data key wrapped with the passcode, and no tokens. */
    async create(passcode: string): Promise<Session> {
        if (this.exists()) throw new Error("There is already a vault");
        const kdf = newKdf(this.iterations);
        const dk = await newDataKey();
        const file: VaultFile = {
            format: FORMAT, version: 1, kdf,
            wrappedKey: await wrapKey(dk, await deriveKey(passcode, kdf), KEY_CONTEXT),
            data: await sealJson(dk, [], DATA_CONTEXT),
        };
        this.store.setItem(VAULT_KEY, JSON.stringify(file));
        // Use a non-extractable copy from here on.
        return this.unlock(passcode);
    }

    /** Throws SealError for a wrong passcode. */
    async unlock(passcode: string): Promise<Session> {
        const file = readFile(this.store);
        if (!file) throw new Error("No vault yet");
        const dk = await unwrapKey(file.wrappedKey, await deriveKey(passcode, file.kdf), KEY_CONTEXT, false);
        const s = new Session(this.store, dk);
        await s.reload();
        return s;
    }

    /**
     * Protect the data key with a new passcode (after the device passcode
     * changed). Needs the old one. The data is not re-encrypted.
     */
    async rewrap(oldPasscode: string, newPasscode: string): Promise<void> {
        const file = readFile(this.store);
        if (!file) throw new Error("No vault yet");
        const dk = await unwrapKey(file.wrappedKey, await deriveKey(oldPasscode, file.kdf), KEY_CONTEXT, true);
        const kdf = newKdf(this.iterations ?? file.kdf.iterations);
        const next: VaultFile = { ...file, kdf, wrappedKey: await wrapKey(dk, await deriveKey(newPasscode, kdf), KEY_CONTEXT) };
        this.store.setItem(VAULT_KEY, JSON.stringify(next));
    }
}

export class DuplicateError extends Error {
    constructor() {
        super("This code is already in the list.");
        this.name = "DuplicateError";
    }
}

export class Session {
    private store: KeyValueStore;
    private dk: CryptoKey | null;
    tokens: Token[] = [];

    constructor(store: KeyValueStore, dk: CryptoKey) {
        this.store = store;
        this.dk = dk;
    }

    /** Forget the key and the tokens (on lock). */
    close(): void {
        this.dk = null;
        this.tokens = [];
    }

    get open(): boolean {
        return this.dk !== null;
    }

    private key(): CryptoKey {
        if (!this.dk) throw new Error("Locked");
        return this.dk;
    }

    /** Decrypt the list. The caller must not keep it. */
    async records(): Promise<TokenRecord[]> {
        const file = readFile(this.store);
        if (!file) throw new Error("No vault");
        return unsealJson<TokenRecord[]>(this.key(), file.data, DATA_CONTEXT);
    }

    private async write(records: TokenRecord[]): Promise<void> {
        const file = readFile(this.store)!;
        file.data = await sealJson(this.key(), records, DATA_CONTEXT);
        this.store.setItem(VAULT_KEY, JSON.stringify(file));
        await this.load(records);
    }

    private async load(records: TokenRecord[]): Promise<void> {
        const out: Token[] = [];
        for (const r of records) {
            const { secret, ...meta } = r;
            out.push({ ...meta, key: await importOtpKey(parseSecret(secret), r.algorithm) });
        }
        this.tokens = sortTokens(out);
    }

    async reload(): Promise<void> {
        await this.load(await this.records());
    }

    /** Add tokens; ones already there are skipped. Returns how many were added. */
    async add(list: OtpParams[]): Promise<number> {
        const records = await this.records();
        let added = 0;
        for (const p of list) {
            const r = recordOf(p);
            if (records.some((x) => sameToken(x, r))) continue;
            records.push(r);
            added++;
        }
        if (added) await this.write(records);
        return added;
    }

    /** Add one; throws DuplicateError if it is there already. */
    async addOne(p: OtpParams): Promise<void> {
        if (!(await this.add([p]))) throw new DuplicateError();
    }

    async rename(id: string, issuer: string, account: string): Promise<void> {
        const records = await this.records();
        const r = records.find((x) => x.id === id);
        if (!r) return;
        r.issuer = issuer.trim();
        r.account = account.trim();
        await this.write(records);
    }

    async remove(id: string): Promise<void> {
        await this.write((await this.records()).filter((x) => x.id !== id));
    }

    /** HOTP: the code for the current counter, and the counter moves on (saved first, so a code is never shown twice). */
    async nextHotp(id: string): Promise<string> {
        const records = await this.records();
        const r = records.find((x) => x.id === id);
        const t = this.tokens.find((x) => x.id === id);
        if (!r || !t || r.type !== "hotp") throw new Error("Not an HOTP code");
        const counter = r.counter;
        r.counter = counter + 1;
        await this.write(records);
        return hotp(t.key, counter, r.digits);
    }
}
