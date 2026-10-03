// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
    deriveKey, fromBase64, randomBytes, newDataKey, newKdf, sealJson, sealWithPassphrase, SealError, toBase64, unsealJson, unsealWithPassphrase,
    unwrapKey, wrapKey,
} from "./seal";

const FAST = 100_000;

describe("sealing", () => {
    it("base64 round-trips large buffers", () => {
        const b = randomBytes(100_000);
        expect(fromBase64(toBase64(b))).toEqual(b);
    });

    it("wraps a data key with a passcode and unwraps it only with that passcode", async () => {
        const kdf = newKdf(FAST);
        const dk = await newDataKey();
        const wrapped = await wrapKey(dk, await deriveKey("2468", kdf), "test:key");
        const sealed = await sealJson(dk, { hello: "world" }, "test:data");
        expect(JSON.stringify(sealed)).not.toContain("world");

        const again = await unwrapKey(wrapped, await deriveKey("2468", kdf), "test:key");
        expect(again.extractable).toBe(false);
        expect(await unsealJson(again, sealed, "test:data")).toEqual({ hello: "world" });

        await expect(unwrapKey(wrapped, await deriveKey("1357", kdf), "test:key")).rejects.toBeInstanceOf(SealError);
        // The context is bound in: a record cannot be passed off as another.
        await expect(unsealJson(again, sealed, "other:data")).rejects.toBeInstanceOf(SealError);
    });

    it("notices tampering", async () => {
        const dk = await newDataKey();
        const sealed = await sealJson(dk, [1, 2, 3], "ctx");
        const ct = fromBase64(sealed.ct);
        ct[0] ^= 1;
        await expect(unsealJson(dk, { ...sealed, ct: toBase64(ct) }, "ctx")).rejects.toBeInstanceOf(SealError);
    });

    it("uses a fresh nonce every time", async () => {
        const dk = await newDataKey();
        const a = await sealJson(dk, "same", "ctx"), b = await sealJson(dk, "same", "ctx");
        expect(a.iv).not.toBe(b.iv);
        expect(a.ct).not.toBe(b.ct);
    });

    it("seals files with a passphrase", async () => {
        // "!" and spaces never occur in base64: only a leak could put the
        // secret in the file (a plain "abc" turned up in the ciphertext by
        // chance, ...TIabc=).
        const secret = "open sesame!";
        const f = await sealWithPassphrase("phoenix-test", { secret }, "correct horse", FAST);
        expect(JSON.stringify(f)).not.toContain(secret);
        expect(JSON.stringify(f)).not.toContain("sesame");
        expect(await unsealWithPassphrase(f, "correct horse")).toEqual({ secret });
        await expect(unsealWithPassphrase(f, "wrong")).rejects.toBeInstanceOf(SealError);
    });

    it("refuses unreasonable key derivation parameters (a crafted file)", async () => {
        await expect(deriveKey("x", { alg: "PBKDF2-SHA256", iterations: 1, salt: "AAAA" })).rejects.toThrow();
        await expect(deriveKey("x", { alg: "PBKDF2-SHA256", iterations: 1e9, salt: "AAAA" })).rejects.toThrow();
    });
});
