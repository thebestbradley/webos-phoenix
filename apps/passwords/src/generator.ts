// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The password generator: characters drawn with crypto.getRandomValues and
// rejection sampling (no modulo bias), at least one from each chosen set,
// shuffled with Fisher-Yates on the same source.

export interface GeneratorOptions {
    length: number;
    lower: boolean;
    upper: boolean;
    digits: boolean;
    symbols: boolean;
    /** Leave out look-alikes: I l 1 O 0 o, and | ` ' " */
    noAmbiguous: boolean;
}

export const DEFAULT_GENERATOR: GeneratorOptions = { length: 20, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: true };
export const MIN_LENGTH = 8;
export const MAX_LENGTH = 64;

const SETS = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    symbols: "!#$%&()*+,-./:;<=>?@[]^_{}~|`'\"",
};
const AMBIGUOUS = /[Il1O0o|`'"]/g;

type Random = (n: number) => Uint32Array;
const cryptoRandom: Random = (n) => globalThis.crypto.getRandomValues(new Uint32Array(n));

/** A uniform integer in [0, n). */
export function randomBelow(n: number, random: Random = cryptoRandom): number {
    if (!(n > 0 && n <= 0x100000000)) throw new Error("bad range");
    const limit = 0x100000000 - (0x100000000 % n);   // largest multiple of n that fits
    for (;;) {
        const v = random(1)[0];
        if (v < limit) return v % n;
    }
}

export function charsets(o: GeneratorOptions): string[] {
    return (["lower", "upper", "digits", "symbols"] as const)
        .filter((k) => o[k])
        .map((k) => (o.noAmbiguous ? SETS[k].replace(AMBIGUOUS, "") : SETS[k]));
}

export function generatePassword(o: GeneratorOptions, random: Random = cryptoRandom): string {
    const sets = charsets(o);
    if (!sets.length) throw new Error("Choose at least one kind of character");
    const length = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, Math.round(o.length)));
    const all = sets.join("");
    const chars: string[] = sets.map((s) => s[randomBelow(s.length, random)]);
    while (chars.length < length) chars.push(all[randomBelow(all.length, random)]);
    for (let i = chars.length - 1; i > 0; --i) {
        const j = randomBelow(i + 1, random);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
}

/** Bits of entropy of a generated password (log2 of the alphabet per character). */
export function generatedEntropy(o: GeneratorOptions): number {
    const n = charsets(o).join("").length;
    return n ? Math.round(Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, o.length)) * Math.log2(n)) : 0;
}

export type Strength = "none" | "weak" | "fair" | "good" | "strong";

/**
 * A rough strength for a typed password: the character classes it uses
 * times its length, discounted for repeats and very common passwords. An
 * estimate for the meter, not a guarantee.
 */
export function estimateBits(pw: string): number {
    if (!pw) return 0;
    if (/^(password|123456|qwerty|letmein|admin|welcome|iloveyou|monkey|dragon|abc123)/i.test(pw) && pw.length < 12) return 10;
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
    const unique = new Set(pw).size;
    const effective = Math.min(pw.length, unique * 1.5);
    return Math.round(effective * Math.log2(Math.max(pool, 2)));
}

export function strengthOf(bits: number): Strength {
    if (bits <= 0) return "none";
    if (bits < 40) return "weak";
    if (bits < 60) return "fair";
    if (bits < 80) return "good";
    return "strong";
}
