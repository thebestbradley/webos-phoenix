// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    charsets, DEFAULT_GENERATOR, estimateBits, generatedEntropy, generatePassword, MAX_LENGTH, MIN_LENGTH, randomBelow, strengthOf,
} from "./generator";
import { fileNameFor, isKdbx } from "./storage";

describe("password generator", () => {
    it("honours the length and uses every chosen kind", () => {
        for (let i = 0; i < 50; ++i) {
            const pw = generatePassword({ ...DEFAULT_GENERATOR, length: 12 });
            expect(pw).toHaveLength(12);
            expect(pw).toMatch(/[a-z]/);
            expect(pw).toMatch(/[A-Z]/);
            expect(pw).toMatch(/[0-9]/);
            expect(pw).toMatch(/[^a-zA-Z0-9]/);
            expect(pw).not.toMatch(/[Il1O0o|`'"]/);
        }
    });
    it("clamps the length and needs at least one kind", () => {
        expect(generatePassword({ ...DEFAULT_GENERATOR, length: 2 })).toHaveLength(MIN_LENGTH);
        expect(generatePassword({ ...DEFAULT_GENERATOR, length: 500 })).toHaveLength(MAX_LENGTH);
        expect(() => generatePassword({ ...DEFAULT_GENERATOR, lower: false, upper: false, digits: false, symbols: false })).toThrow();
        expect(generatePassword({ ...DEFAULT_GENERATOR, upper: false, symbols: false, lower: false })).toMatch(/^[2-9]+$/);
    });
    it("draws without modulo bias (rejection sampling)", () => {
        // A source that first returns values in the biased tail: they must be skipped.
        const values = [0xffffffff, 0xfffffffe, 7];
        let i = 0;
        const src = (n: number) => Uint32Array.from({ length: n }, () => values[i++]);
        expect(randomBelow(10, src)).toBe(7);
        expect(i).toBe(3);
    });
    it("is roughly uniform", () => {
        const counts = new Array(6).fill(0);
        for (let k = 0; k < 6000; ++k) counts[randomBelow(6)]++;
        for (const c of counts) expect(c).toBeGreaterThan(850);
    });
    it("reports entropy and strength", () => {
        const n = charsets(DEFAULT_GENERATOR).join("").length;
        expect(generatedEntropy(DEFAULT_GENERATOR)).toBe(Math.round(20 * Math.log2(n)));
        expect(strengthOf(estimateBits(""))).toBe("none");
        expect(strengthOf(estimateBits("password1"))).toBe("weak");
        expect(strengthOf(estimateBits("aaaaaaaaaaaaaaaaaaaa"))).toBe("weak");
        expect(strengthOf(estimateBits("Tr0ub4dor&3xyzQ!"))).toMatch(/good|strong/);
    });
});

describe("database file names", () => {
    it("makes safe .kdbx names", () => {
        expect(fileNameFor("Personal")).toBe("Personal.kdbx");
        expect(fileNameFor(" Work.kdbx ")).toBe("Work.kdbx");
        for (const bad of ["", "  ", "../x", "a/b", ".hidden", "x".repeat(81)]) expect(fileNameFor(bad), bad).toBeNull();
        expect(isKdbx("A.KDBX")).toBe(true);
        expect(isKdbx("a.kdbx.tmp")).toBe(false);
    });
});
