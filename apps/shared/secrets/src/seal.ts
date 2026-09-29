// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sealing data with WebCrypto: AES-256-GCM for the data, PBKDF2-SHA256 to
// turn a passcode or passphrase into a key, and AES-GCM key wrapping so a
// random data key can be protected by several passcodes (and re-wrapped
// when the passcode changes without re-encrypting the data).
//
// Sealed records are plain JSON (base64 fields) and carry their parameters,
// so the iteration count can be raised later without breaking old records.
//
// Nothing here logs, and errors never include key material or plaintext.

export const PBKDF2_ITERATIONS = 600_000;   // OWASP's 2023 figure for PBKDF2-HMAC-SHA256

function subtle(): SubtleCrypto {
    const s = globalThis.crypto?.subtle;
    if (!s) throw new Error("WebCrypto is not available");
    return s;
}

export function randomBytes(n: number): Uint8Array {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
    return b;
}

export function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
    const s = atob(text);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; ++i) b[i] = s.charCodeAt(i);
    return b;
}

/** Wrong passcode, or the record was changed: AES-GCM cannot tell them apart. */
export class SealError extends Error {
    constructor(message = "Wrong passcode, or the data is damaged") {
        super(message);
        this.name = "SealError";
    }
}

export interface KdfParams {
    alg: "PBKDF2-SHA256";
    iterations: number;
    /** base64 */
    salt: string;
}

export interface Sealed {
    /** base64 12-byte nonce */
    iv: string;
    /** base64 ciphertext with the GCM tag */
    ct: string;
}

export function newKdf(iterations = PBKDF2_ITERATIONS): KdfParams {
    return { alg: "PBKDF2-SHA256", iterations, salt: toBase64(randomBytes(16)) };
}

/** A key-encryption key from a passcode. Not extractable. */
export async function deriveKey(passcode: string, kdf: KdfParams): Promise<CryptoKey> {
    if (kdf.alg !== "PBKDF2-SHA256") throw new Error("Unknown key derivation " + kdf.alg);
    if (!(kdf.iterations >= 100_000 && kdf.iterations <= 10_000_000)) throw new Error("Unreasonable key derivation parameters");
    const base = await subtle().importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveKey"]);
    return subtle().deriveKey(
        { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(kdf.salt) as BufferSource, iterations: kdf.iterations },
        base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
}

/** A new random data key. Extractable only so that it can be wrapped. */
export function newDataKey(): Promise<CryptoKey> {
    return subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]) as Promise<CryptoKey>;
}

/** Wrap (encrypt) a data key with a key-encryption key. */
export async function wrapKey(dataKey: CryptoKey, kek: CryptoKey, context: string): Promise<Sealed> {
    const iv = randomBytes(12);
    const ct = await subtle().wrapKey("raw", dataKey, kek, { name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(context) });
    return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

/**
 * Unwrap a data key. `extractable` false gives a key the page can use but
 * never read; pass true only to re-wrap it (a passcode change).
 */
export async function unwrapKey(sealed: Sealed, kek: CryptoKey, context: string, extractable = false): Promise<CryptoKey> {
    try {
        return await subtle().unwrapKey("raw", fromBase64(sealed.ct) as BufferSource, kek,
            { name: "AES-GCM", iv: fromBase64(sealed.iv) as BufferSource, additionalData: new TextEncoder().encode(context) },
            { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
    } catch {
        throw new SealError();
    }
}

/** Encrypt bytes. `context` is bound in as associated data (what the record is). */
export async function seal(key: CryptoKey, plain: Uint8Array, context: string): Promise<Sealed> {
    const iv = randomBytes(12);
    const ct = await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(context) }, key, plain as BufferSource);
    return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function unseal(key: CryptoKey, sealed: Sealed, context: string): Promise<Uint8Array> {
    try {
        return new Uint8Array(await subtle().decrypt(
            { name: "AES-GCM", iv: fromBase64(sealed.iv) as BufferSource, additionalData: new TextEncoder().encode(context) },
            key, fromBase64(sealed.ct) as BufferSource));
    } catch {
        throw new SealError();
    }
}

export async function sealJson(key: CryptoKey, value: unknown, context: string): Promise<Sealed> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    try {
        return await seal(key, bytes, context);
    } finally {
        bytes.fill(0);
    }
}

export async function unsealJson<T>(key: CryptoKey, sealed: Sealed, context: string): Promise<T> {
    const bytes = await unseal(key, sealed, context);
    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } finally {
        bytes.fill(0);
    }
}

// ---- Passphrase-sealed files (encrypted backups) -------------------------------------

export interface PassphraseFile {
    format: string;
    version: 1;
    kdf: KdfParams;
    data: Sealed;
}

/** Seal a value with a passphrase into a self-describing JSON file. */
export async function sealWithPassphrase(format: string, value: unknown, passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<PassphraseFile> {
    const kdf = newKdf(iterations);
    const key = await deriveKey(passphrase, kdf);
    return { format, version: 1, kdf, data: await sealJson(key, value, format) };
}

export function isPassphraseFile(v: unknown, format: string): v is PassphraseFile {
    const f = v as PassphraseFile;
    return !!f && typeof f === "object" && f.format === format && f.version === 1 && !!f.kdf && !!f.data;
}

export async function unsealWithPassphrase<T>(file: PassphraseFile, passphrase: string): Promise<T> {
    const key = await deriveKey(passphrase, file.kdf);
    return unsealJson<T>(key, file.data, file.format);
}
