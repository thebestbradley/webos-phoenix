// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Import and export.
//
//   Phoenix backup     {format: "phoenix-authenticator-backup", kdf, data}:
//                      the tokens as otpauth:// URIs, sealed with a passphrase
//                      (PBKDF2-SHA256 + AES-256-GCM, @phoenix/secrets)
//   Aegis              the plain (unencrypted) JSON export, db.entries[];
//                      encrypted Aegis vaults are recognised and refused
//   andOTP             the plain JSON export, an array of entries
//   otpauth:// lists   a text file with one otpauth:// URI per line (Aegis,
//                      2FAS and others export this)
//
// Plain exports hold every secret in clear: the app warns before reading
// one and offers to delete the file afterwards.

import {
    isPassphraseFile, parseOtpauth, parseSecret, sealWithPassphrase, unsealWithPassphrase, validateOtp, buildOtpauth,
    type OtpAlgorithm, type OtpParams, type PassphraseFile,
} from "@phoenix/secrets";
import { paramsOf, type TokenRecord } from "./vault";

export const BACKUP_FORMAT = "phoenix-authenticator-backup";

export type ImportKind = "phoenix" | "aegis" | "aegis-encrypted" | "andotp" | "uris" | "unknown";

export interface ImportResult {
    tokens: OtpParams[];
    /** Entries that could not be used (unsupported type, bad secret). */
    skipped: number;
}

export function detect(text: string): ImportKind {
    const t = text.trim();
    if (/^otpauth:\/\//m.test(t) && !t.startsWith("{") && !t.startsWith("[")) return "uris";
    let v: unknown;
    try { v = JSON.parse(t); } catch { return "unknown"; }
    if (isPassphraseFile(v, BACKUP_FORMAT)) return "phoenix";
    if (Array.isArray(v)) return v.length === 0 || (typeof v[0] === "object" && v[0] && "secret" in v[0]) ? "andotp" : "unknown";
    const o = v as { header?: { slots?: unknown }; db?: unknown };
    if (o && typeof o === "object" && o.header && "db" in o) return o.header.slots || typeof o.db === "string" ? "aegis-encrypted" : "aegis";
    return "unknown";
}

/** Is this kind a file that holds secrets in clear? */
export function isPlaintext(kind: ImportKind): boolean {
    return kind === "aegis" || kind === "andotp" || kind === "uris";
}

const ALGS: Record<string, OtpAlgorithm> = { SHA1: "SHA1", SHA256: "SHA256", SHA512: "SHA512" };

function algorithm(v: unknown): OtpAlgorithm {
    const a = ALGS[String(v ?? "SHA1").toUpperCase().replace("-", "")];
    if (!a) throw new Error("algorithm");
    return a;
}

function num(v: unknown, def: number): number {
    if (v === undefined || v === null || v === "") return def;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("number");
    return n;
}

function collect(items: unknown[], one: (x: Record<string, unknown>) => OtpParams | null): ImportResult {
    const tokens: OtpParams[] = [];
    let skipped = 0;
    for (const x of items) {
        try {
            const p = x && typeof x === "object" ? one(x as Record<string, unknown>) : null;
            if (p) tokens.push(validateOtp(p));
            else skipped++;
        } catch {
            skipped++;
        }
    }
    return { tokens, skipped };
}

export function parseAegis(text: string): ImportResult {
    const v = JSON.parse(text) as { db?: { entries?: unknown[] } };
    const entries = v.db?.entries;
    if (!Array.isArray(entries)) throw new Error("This is not an Aegis export.");
    return collect(entries, (e) => {
        const type = String(e.type).toLowerCase();
        if (type !== "totp" && type !== "hotp") return null;   // steam, motp, yandex: not supported
        const info = (e.info ?? {}) as Record<string, unknown>;
        return {
            type, issuer: String(e.issuer ?? ""), account: String(e.name ?? ""), secret: parseSecret(String(info.secret ?? "")),
            algorithm: algorithm(info.algo), digits: num(info.digits, 6), period: num(info.period, 30), counter: num(info.counter, 0),
        };
    });
}

export function parseAndOtp(text: string): ImportResult {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) throw new Error("This is not an andOTP export.");
    return collect(v, (e) => {
        const type = String(e.type ?? "TOTP").toLowerCase();
        if (type !== "totp" && type !== "hotp") return null;
        let issuer = String(e.issuer ?? ""), account = String(e.label ?? "");
        if (!issuer && account.includes(":")) [issuer, account] = [account.slice(0, account.indexOf(":")), account.slice(account.indexOf(":") + 1)];
        return {
            type, issuer: issuer.trim(), account: account.trim(), secret: parseSecret(String(e.secret ?? "")), algorithm: algorithm(e.algorithm),
            digits: num(e.digits, 6), period: num(e.period, 30), counter: num(e.counter, 0),
        };
    });
}

export function parseUriList(text: string): ImportResult {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("otpauth://"));
    const tokens: OtpParams[] = [];
    let skipped = 0;
    for (const l of lines) {
        try { tokens.push(parseOtpauth(l)); } catch { skipped++; }
    }
    return { tokens, skipped };
}

/** Parse a plain export of any supported kind. */
export function parsePlain(text: string): ImportResult {
    const kind = detect(text);
    if (kind === "aegis") return parseAegis(text);
    if (kind === "andotp") return parseAndOtp(text);
    if (kind === "uris") return parseUriList(text);
    if (kind === "aegis-encrypted") throw new Error("Encrypted Aegis vaults cannot be read yet. In Aegis, export without encryption, import that file here, then delete it.");
    throw new Error("This file is not an export Authenticator knows.");
}

export async function makeBackup(records: TokenRecord[], passphrase: string, iterations?: number): Promise<string> {
    const file = await sealWithPassphrase(BACKUP_FORMAT, { tokens: records.map((r) => buildOtpauth(paramsOf(r))) }, passphrase, iterations);
    return JSON.stringify(file, null, 1);
}

/** Throws SealError for a wrong passphrase. */
export async function readBackup(text: string, passphrase: string): Promise<ImportResult> {
    const file = JSON.parse(text) as PassphraseFile;
    const v = await unsealWithPassphrase<{ tokens?: unknown }>(file, passphrase);
    if (!Array.isArray(v.tokens)) throw new Error("The backup is damaged.");
    return parseUriList((v.tokens as unknown[]).filter((x): x is string => typeof x === "string").join("\n"));
}

/** "Authenticator backup 2026-09-28.json" */
export function backupName(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `Authenticator backup ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}
