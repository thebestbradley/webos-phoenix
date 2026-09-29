// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode } from "./base32";
import {
    buildOtpauth, groupCode, hotp, importOtpKey, OtpUriError, parseOtpauth, totp, totpCounter, totpRemaining, type OtpAlgorithm,
} from "./otp";

const ascii = (s: string) => new TextEncoder().encode(s);

describe("base32 (RFC 4648 section 10 vectors)", () => {
    const vectors: [string, string][] = [
        ["", ""], ["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"],
    ];
    it.each(vectors)("%j <-> %s", (plain, enc) => {
        expect(base32Encode(ascii(plain))).toBe(enc);
        expect(new TextDecoder().decode(base32Decode(enc))).toBe(plain);
    });
    it("ignores case, spaces, dashes and padding", () => {
        expect(new TextDecoder().decode(base32Decode("mzxw 6ytb-oi======"))).toBe("foobar");
    });
    it("rejects other characters and impossible lengths", () => {
        expect(() => base32Decode("MZXW1")).toThrow();
        expect(() => base32Decode("M")).toThrow();
        expect(() => base32Decode("MZX")).toThrow();
    });
    it("round-trips random bytes", () => {
        for (let n = 0; n < 40; ++n) {
            const b = crypto.getRandomValues(new Uint8Array(n));
            expect(base32Decode(base32Encode(b))).toEqual(b);
        }
    });
});

describe("HOTP (RFC 4226 appendix D)", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    it("gives the ten test values", async () => {
        const key = await importOtpKey(ascii("12345678901234567890"), "SHA1");
        for (let c = 0; c < 10; ++c) expect(await hotp(key, c, 6)).toBe(expected[c]);
    });
});

describe("TOTP (RFC 6238 appendix B)", () => {
    const secrets: Record<OtpAlgorithm, string> = {
        SHA1: "12345678901234567890",
        SHA256: "12345678901234567890123456789012",
        SHA512: "1234567890123456789012345678901234567890123456789012345678901234",
    };
    const table: [number, string, OtpAlgorithm][] = [
        [59, "94287082", "SHA1"], [59, "46119246", "SHA256"], [59, "90693936", "SHA512"],
        [1111111109, "07081804", "SHA1"], [1111111109, "68084774", "SHA256"], [1111111109, "25091201", "SHA512"],
        [1111111111, "14050471", "SHA1"], [1111111111, "67062674", "SHA256"], [1111111111, "99943326", "SHA512"],
        [1234567890, "89005924", "SHA1"], [1234567890, "91819424", "SHA256"], [1234567890, "93441116", "SHA512"],
        [2000000000, "69279037", "SHA1"], [2000000000, "90698825", "SHA256"], [2000000000, "38618901", "SHA512"],
        [20000000000, "65353130", "SHA1"], [20000000000, "77737706", "SHA256"], [20000000000, "47863826", "SHA512"],
    ];
    it.each(table)("T=%i gives %s with %s", async (t, code, alg) => {
        const key = await importOtpKey(ascii(secrets[alg]), alg);
        expect(await totp(key, t * 1000, 8, 30)).toBe(code);
    });
    it("counts time steps and the seconds left", () => {
        expect(totpCounter(59_000)).toBe(1);
        expect(totpCounter(20000000000_000)).toBe(666666666);
        expect(totpRemaining(59_000)).toBe(1);
        expect(totpRemaining(60_000)).toBe(30);
        expect(totpRemaining(61_500, 60)).toBeCloseTo(58.5);
    });
    it("rejects an empty secret and bad counters", async () => {
        expect(() => importOtpKey(new Uint8Array(0), "SHA1")).toThrow();
        const key = await importOtpKey(ascii("12345678901234567890"), "SHA1");
        await expect(hotp(key, -1)).rejects.toThrow();
        await expect(hotp(key, 1.5)).rejects.toThrow();
    });
    it("groups codes for reading", () => {
        expect(groupCode("123456")).toBe("123 456");
        expect(groupCode("12345678")).toBe("1234 5678");
        expect(groupCode("1234567")).toBe("1234567");
    });
});

describe("otpauth:// URIs", () => {
    it("parses the Key URI format example", () => {
        const p = parseOtpauth("otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example");
        expect(p).toMatchObject({ type: "totp", issuer: "Example", account: "alice@google.com", algorithm: "SHA1", digits: 6, period: 30 });
        expect(base32Encode(p.secret)).toBe("JBSWY3DPEHPK3PXP");
    });
    it("reads every parameter, and encoded labels", () => {
        const p = parseOtpauth("otpauth://hotp/ACME%20Co%3Ajohn.doe%40email.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&algorithm=SHA256&digits=8&counter=42");
        expect(p).toMatchObject({ type: "hotp", issuer: "ACME Co", account: "john.doe@email.com", algorithm: "SHA256", digits: 8, counter: 42 });
    });
    it("prefers the issuer parameter; a label without issuer is the account", () => {
        expect(parseOtpauth("otpauth://totp/Old:bob?secret=JBSWY3DP&issuer=New").issuer).toBe("New");
        expect(parseOtpauth("otpauth://totp/bob?secret=JBSWY3DP")).toMatchObject({ issuer: "", account: "bob" });
    });
    it("refuses what it cannot use, with a message", () => {
        const bad = [
            "https://example.org", "otpauth://steam/x?secret=JBSWY3DP", "otpauth://totp/x", "otpauth://totp/x?secret=not*base32",
            "otpauth://totp/x?secret=JBSWY3DP&digits=4", "otpauth://totp/x?secret=JBSWY3DP&digits=abc", "otpauth://totp/x?secret=JBSWY3DP&period=0",
            "otpauth://totp/x?secret=JBSWY3DP&algorithm=MD5", "otpauth://totp/%E0%A4%A?secret=JBSWY3DP",
        ];
        for (const u of bad) expect(() => parseOtpauth(u), u).toThrow(OtpUriError);
    });
    it("round-trips through buildOtpauth", () => {
        for (const u of [
            "otpauth://totp/Git%20Hub:ada%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=Git%20Hub&algorithm=SHA512&digits=8&period=60",
            "otpauth://hotp/solo?secret=JBSWY3DPEHPK3PXP&counter=7",
        ]) {
            const p = parseOtpauth(u);
            expect(parseOtpauth(buildOtpauth(p))).toEqual(p);
        }
    });
});
