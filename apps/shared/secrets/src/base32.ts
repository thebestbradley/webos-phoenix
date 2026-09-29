// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// RFC 4648 base32, the alphabet otpauth:// secrets are written in.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decode base32. Forgiving the way people type secrets: case, spaces,
 * dashes and "=" padding are ignored. Throws on any other character or on
 * a length no encoder produces.
 */
export function base32Decode(text: string): Uint8Array {
    const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
    // 8 characters carry 5 bytes; the lengths 1, 3 and 6 (mod 8) are never produced.
    if ([1, 3, 6].includes(clean.length % 8)) throw new Error("Not a valid base32 length");
    const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
    let bits = 0, value = 0, i = 0;
    for (const ch of clean) {
        const v = ALPHABET.indexOf(ch);
        if (v < 0) throw new Error("Not a base32 character");
        value = (value << 5) | v;
        bits += 5;
        if (bits >= 8) {
            out[i++] = (value >>> (bits - 8)) & 0xff;
            bits -= 8;
        }
        value &= 0xff;   // keep only the bits not yet written
    }
    return out;
}

/** Encode base32 without padding (as otpauth:// URIs carry it). */
export function base32Encode(bytes: Uint8Array): string {
    let out = "", bits = 0, value = 0;
    for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
        value &= 0xff;
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
}
