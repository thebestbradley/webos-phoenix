// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// lib/keys.js: your own AirPods by their keys. The random address hash
// against the Bluetooth Core Specification's sample data; the learner of
// where the batteries are in the encrypted part, on blocks made here with a
// layout the test chooses (it is not a claim about the AirPods' layout:
// that is what the learner finds out on a device).

import { createRequire } from "node:module";
import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const keys = require("./lib/keys.js") as Any;

const IRK = "ec0234a357c8ad05341010a60a397d9b";
const reversed = (h: string) => h.match(/../g)!.reverse().join("");

// An address that resolves with the key: prand (top bits 0b01) and its hash.
function rpa(irk: string, prand: string): string {
    const hash = keys.hex(keys.ah(irk, prand));
    return (prand + hash).match(/../g)!.join(":");
}

// A block as the AirPods would send it, with the batteries at the test's
// positions, under the key.
function block(encKey: string, at: { left: number; right: number; case: number }, b: { left: number; right: number; case: number }, salt = 0) {
    const plain = Buffer.alloc(16, 0x5a);
    for (let i = 0; i < 16; ++i) plain[i] = (0x80 + i * 7 + salt) & 0xff;
    plain[at.left] = b.left;
    plain[at.right] = b.right;
    plain[at.case] = b.case;
    const c = createCipheriv("aes-128-ecb", Buffer.from(encKey, "hex"), null);
    c.setAutoPadding(false);
    return Array.from(Buffer.concat([c.update(plain), c.final()]));
}

describe("Resolving the AirPods' random address (Core Specification Vol 3 Part H §2.2.2)", () => {
    it("matches the specification's sample data for ah", () => {
        expect(keys.hex(keys.ah(IRK, "708194"))).toBe("0dfbaa");
    });

    it("resolves an address made with the key, in either byte order, and nothing else", () => {
        const a = rpa(IRK, "5a1b2c");
        expect(keys.isResolvable(a)).toBe(true);
        expect(keys.resolves(IRK, a)).toBe("as sent");
        expect(keys.resolves(reversed(IRK), a)).toBe("reversed");
        expect(keys.resolves("00112233445566778899aabbccddeeff", a)).toBe("");
        // Not a resolvable private address (top bits 0b11: static random).
        expect(keys.resolves(IRK, "c0:81:94:0d:fb:aa")).toBe("");
        expect(keys.resolves(IRK, "not an address")).toBe("");
    });
});

describe("Where the batteries are in the encrypted part", () => {
    const ENC = "000102030405060708090a0b0c0d0e0f";
    const AT = { left: 3, right: 7, case: 11 };

    it("opens the block in both key orders", () => {
        const opened = keys.decrypt(ENC, block(ENC, AT, { left: 64, right: 55, case: 30 }));
        expect(opened["as sent"][3]).toBe(64);
        expect(opened.reversed).toHaveLength(16);
        expect(keys.decrypt(ENC, [1, 2, 3])).toBeNull();
    });

    it("learns the positions from the AirPods' own reports, then reads the batteries", () => {
        const l = keys.createLearner(null);
        const seen = (b: Any, salt: number) => l.sample(keys.decrypt(ENC, block(ENC, AT, b, salt)), b);
        expect(seen({ left: 64, right: 55, case: 30 }, 0)).toBeNull();
        // The same again adds nothing.
        expect(seen({ left: 64, right: 55, case: 30 }, 0)).toBeNull();
        expect(l.state().samples).toBe(1);
        expect(seen({ left: 64, right: 55, case: 30 }, 1)).toBeNull();
        // The batteries change: settled.
        const layout = seen({ left: 63, right: 55, case: 30 }, 2);
        expect(layout).toEqual({ order: "as sent", left: 3, right: 7, case: 11 });
        expect(keys.batteries(keys.decrypt(ENC, block(ENC, AT, { left: 41, right: 38, case: 77 }, 3)), layout))
            .toEqual({ left: 41, right: 38, case: 77 });
        // Kept and restored.
        expect(keys.createLearner(l.state()).layout()).toEqual(layout);
    });

    it("settles on nothing while left and right are equal, or the batteries never change", () => {
        const l = keys.createLearner(null);
        for (let i = 0; i < 6; ++i) l.sample(keys.decrypt(ENC, block(ENC, AT, { left: 80, right: 80, case: 50 }, i)), { left: 80, right: 80, case: 50 });
        expect(l.layout()).toBeNull();
        const m = keys.createLearner(null);
        for (let i = 0; i < 6; ++i) m.sample(keys.decrypt(ENC, block(ENC, AT, { left: 80, right: 70, case: 50 }, i)), { left: 80, right: 70, case: 50 });
        expect(m.layout()).toBeNull();
    });

    it("settles on nothing if the bytes do not hold the batteries", () => {
        const l = keys.createLearner(null);
        const noise = (i: number) => Array.from({ length: 16 }, (_, j) => (i * 37 + j * 101) & 0xff);
        [[80, 70], [79, 70], [79, 69], [78, 69]].forEach(([left, right], i) =>
            l.sample(keys.decrypt(ENC, noise(i)), { left, right, case: -1 }));
        expect(l.layout()).toBeNull();
    });
});
