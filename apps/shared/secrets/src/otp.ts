// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One-time passwords: HOTP (RFC 4226) and TOTP (RFC 6238) on WebCrypto's
// HMAC, and otpauth:// URIs (the Google Authenticator key URI format that
// QR codes, Aegis, andOTP, KeePassXC and KeePassDX all use).
//
// The HMAC key can be a non-extractable CryptoKey, so an app can drop the
// secret's bytes once it has made the key (see importOtpKey).
//
// Tested against the RFC test vectors (otp.test.ts).

import { base32Decode, base32Encode } from "./base32";

export type OtpAlgorithm = "SHA1" | "SHA256" | "SHA512";
export type OtpType = "totp" | "hotp";

export interface OtpParams {
    type: OtpType;
    /** The shared secret. */
    secret: Uint8Array;
    algorithm: OtpAlgorithm;
    /** 6 to 10 */
    digits: number;
    /** TOTP: seconds per code (usually 30). */
    period: number;
    /** HOTP: the next counter value. */
    counter: number;
    /** Who issued it ("GitHub"). */
    issuer: string;
    /** Whose it is ("ada@example.org"). */
    account: string;
}

export const OTP_DEFAULTS = { algorithm: "SHA1" as OtpAlgorithm, digits: 6, period: 30, counter: 0 };
export const OTP_ALGORITHMS: OtpAlgorithm[] = ["SHA1", "SHA256", "SHA512"];

const HASH: Record<OtpAlgorithm, string> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

function subtle(): SubtleCrypto {
    const s = globalThis.crypto?.subtle;
    if (!s) throw new Error("WebCrypto is not available");
    return s;
}

/** An HMAC key for the secret. Not extractable: the page cannot read the secret back from it. */
export function importOtpKey(secret: Uint8Array, algorithm: OtpAlgorithm): Promise<CryptoKey> {
    if (!secret.length) throw new Error("The secret is empty");
    return subtle().importKey("raw", secret as BufferSource, { name: "HMAC", hash: HASH[algorithm] }, false, ["sign"]);
}

/** The 8-byte big-endian counter. Counters up to 2^53 (JavaScript's safe integers). */
function counterBytes(counter: number): Uint8Array {
    if (!Number.isSafeInteger(counter) || counter < 0) throw new Error("Bad counter");
    const b = new Uint8Array(8);
    const view = new DataView(b.buffer);
    view.setUint32(0, Math.floor(counter / 0x100000000));
    view.setUint32(4, counter >>> 0);
    return b;
}

/** RFC 4226 dynamic truncation of an HMAC to `digits` digits. */
export function truncate(mac: Uint8Array, digits: number): string {
    const offset = mac[mac.length - 1] & 0x0f;
    const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
    // 10 digits exceed 2^31: the modulo is then a no-op, and the code is zero-padded.
    return String(bin % 10 ** Math.min(digits, 10)).padStart(digits, "0");
}

/** HOTP (RFC 4226) for a counter. */
export async function hotp(key: CryptoKey, counter: number, digits = 6): Promise<string> {
    const mac = new Uint8Array(await subtle().sign("HMAC", key, counterBytes(counter) as BufferSource));
    return truncate(mac, digits);
}

/** The TOTP time step for a moment (RFC 6238: T0 = 0). */
export function totpCounter(timeMs: number, period = 30): number {
    return Math.floor(timeMs / 1000 / period);
}

/** Seconds until the code for this moment changes. */
export function totpRemaining(timeMs: number, period = 30): number {
    return period - ((timeMs / 1000) % period);
}

/** TOTP (RFC 6238) at a moment. */
export function totp(key: CryptoKey, timeMs: number, digits = 6, period = 30): Promise<string> {
    return hotp(key, totpCounter(timeMs, period), digits);
}

/** "123456" as "123 456", "12345678" as "1234 5678". */
export function groupCode(code: string): string {
    if (code.length === 6) return code.slice(0, 3) + " " + code.slice(3);
    if (code.length === 8) return code.slice(0, 4) + " " + code.slice(4);
    return code;
}

// ---- otpauth:// URIs -----------------------------------------------------------------

export class OtpUriError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OtpUriError";
    }
}

function intParam(v: string | null, def: number, min: number, max: number, what: string): number {
    if (v === null || v === "") return def;
    if (!/^\d+$/.test(v)) throw new OtpUriError(`The ${what} is not a number`);
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new OtpUriError(`The ${what} is out of range`);
    return n;
}

/** Check parameters (from a URI, a form or an import); throws OtpUriError. */
export function validateOtp(p: OtpParams): OtpParams {
    if (p.type !== "totp" && p.type !== "hotp") throw new OtpUriError("Only TOTP and HOTP are supported");
    if (!p.secret.length) throw new OtpUriError("The secret is missing");
    if (!OTP_ALGORITHMS.includes(p.algorithm)) throw new OtpUriError("Unsupported algorithm");
    if (!Number.isInteger(p.digits) || p.digits < 6 || p.digits > 10) throw new OtpUriError("Codes must have 6 to 10 digits");
    if (!Number.isInteger(p.period) || p.period < 1 || p.period > 3600) throw new OtpUriError("The period is out of range");
    if (!Number.isSafeInteger(p.counter) || p.counter < 0) throw new OtpUriError("The counter is out of range");
    return p;
}

/** Decode the secret as typed or scanned (base32). */
export function parseSecret(text: string): Uint8Array {
    try {
        return base32Decode(text);
    } catch {
        throw new OtpUriError("The secret is not valid base32 (letters A to Z and digits 2 to 7)");
    }
}

/**
 * Parse an otpauth:// URI:
 *   otpauth://totp/Issuer:account?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&period=30
 *   otpauth://hotp/account?secret=BASE32&counter=0
 * Throws OtpUriError with a message for people.
 */
export function parseOtpauth(uri: string): OtpParams {
    const m = /^otpauth:\/\/([a-z]+)\/([^?#]*)(?:\?([^#]*))?/i.exec(uri.trim());
    if (!m) throw new OtpUriError("Not an otpauth:// link");
    const type = m[1].toLowerCase();
    if (type !== "totp" && type !== "hotp") throw new OtpUriError(`"${type}" codes are not supported`);
    const q = new URLSearchParams(m[3] ?? "");
    let label: string;
    try { label = decodeURIComponent(m[2]); } catch { throw new OtpUriError("The label is not valid"); }
    let issuer = "", account = label;
    const colon = label.indexOf(":");
    if (colon >= 0) { issuer = label.slice(0, colon).trim(); account = label.slice(colon + 1); }
    account = account.trim();
    // The issuer parameter wins over the label's prefix (the Key URI format says it should match).
    const qIssuer = q.get("issuer");
    if (qIssuer) issuer = qIssuer.trim();
    const secretText = q.get("secret");
    if (!secretText) throw new OtpUriError("The link has no secret");
    const algorithm = (q.get("algorithm") || "SHA1").toUpperCase().replace("-", "") as OtpAlgorithm;
    return validateOtp({
        type,
        secret: parseSecret(secretText),
        algorithm,
        digits: intParam(q.get("digits"), OTP_DEFAULTS.digits, 1, 99, "number of digits"),
        period: intParam(q.get("period"), OTP_DEFAULTS.period, 1, 99999, "period"),
        counter: intParam(q.get("counter"), OTP_DEFAULTS.counter, 0, Number.MAX_SAFE_INTEGER, "counter"),
        issuer,
        account,
    });
}

/** Write an otpauth:// URI (for export and for KeePass's "otp" field). */
export function buildOtpauth(p: OtpParams): string {
    const label = p.issuer ? `${encodeURIComponent(p.issuer)}:${encodeURIComponent(p.account)}` : encodeURIComponent(p.account);
    const q = new URLSearchParams({ secret: base32Encode(p.secret) });
    if (p.issuer) q.set("issuer", p.issuer);
    q.set("algorithm", p.algorithm);
    q.set("digits", String(p.digits));
    if (p.type === "totp") q.set("period", String(p.period));
    else q.set("counter", String(p.counter));
    return `otpauth://${p.type}/${label}?${q.toString()}`;
}
