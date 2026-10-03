// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { base32Decode, hotp, importOtpKey, parseOtpauth, SealError, totp } from "@phoenix/secrets";
import { DuplicateError, Vault, VAULT_KEY, type KeyValueStore } from "./vault";
import { BACKUP_FORMAT, detect, isPlaintext, makeBackup, parseAegis, parseAndOtp, parsePlain, parseUriList, readBackup } from "./importers";

const FAST = 100_000;
function memory(): KeyValueStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const GH = "otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";
const RFC_HOTP = "otpauth://hotp/RFC:4226?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=RFC&counter=0";   // "12345678901234567890"

describe("vault", () => {
    it("keeps only ciphertext at rest", async () => {
        const store = memory();
        const v = new Vault(store, FAST);
        const s = await v.create("2468");
        await s.addOne(parseOtpauth(GH));
        const raw = store.data.get(VAULT_KEY)!;
        expect(raw).not.toContain("JBSWY3DPEHPK3PXP");
        expect(raw).not.toContain("GitHub");
        expect(raw).not.toContain("2468");
        expect(JSON.parse(raw)).toMatchObject({ format: "phoenix-authenticator-vault", version: 1, kdf: { alg: "PBKDF2-SHA256" } });
    });

    it("unlocks with the passcode only; codes are right", async () => {
        const store = memory();
        await (await new Vault(store, FAST).create("2468")).addOne(parseOtpauth(GH));
        await expect(new Vault(store, FAST).unlock("1357")).rejects.toBeInstanceOf(SealError);
        const s = await new Vault(store, FAST).unlock("2468");
        expect(s.tokens.map((t) => [t.issuer, t.account])).toEqual([["GitHub", "ada"]]);
        expect(s.tokens[0].key.extractable).toBe(false);
        expect("secret" in s.tokens[0]).toBe(false);
        const ref = await importOtpKey(base32Decode("JBSWY3DPEHPK3PXP"), "SHA1");
        expect(await totp(s.tokens[0].key, 1_700_000_000_000)).toBe(await totp(ref, 1_700_000_000_000));
    });

    it("re-protects the data key when the passcode changes", async () => {
        const store = memory();
        await (await new Vault(store, FAST).create("2468")).addOne(parseOtpauth(GH));
        const v = new Vault(store, FAST);
        await expect(v.rewrap("0000", "97531")).rejects.toBeInstanceOf(SealError);
        await v.rewrap("2468", "97531");
        await expect(v.unlock("2468")).rejects.toBeInstanceOf(SealError);
        expect((await v.unlock("97531")).tokens).toHaveLength(1);
    });

    it("adds, skips duplicates, renames and removes", async () => {
        const s = await new Vault(memory(), FAST).create("2468");
        expect(await s.add([parseOtpauth(GH), parseOtpauth(GH), parseOtpauth(RFC_HOTP)])).toBe(2);
        await expect(s.addOne(parseOtpauth(GH))).rejects.toBeInstanceOf(DuplicateError);
        const id = s.tokens.find((t) => t.issuer === "GitHub")!.id;
        await s.rename(id, " Work GitHub ", "ada@work");
        expect(s.tokens.map((t) => t.issuer)).toEqual(["RFC", "Work GitHub"]);
        await s.remove(id);
        expect(s.tokens).toHaveLength(1);
    });

    it("steps HOTP counters (RFC 4226 values) and saves the counter first", async () => {
        const store = memory();
        const s = await new Vault(store, FAST).create("2468");
        await s.addOne(parseOtpauth(RFC_HOTP));
        const id = s.tokens[0].id;
        expect(await s.nextHotp(id)).toBe("755224");
        expect(await s.nextHotp(id)).toBe("287082");
        const again = await new Vault(store, FAST).unlock("2468");
        expect(again.tokens[0].counter).toBe(2);
        expect(await again.nextHotp(id)).toBe("359152");
        expect(await hotp(again.tokens[0].key, 3)).toBe("969429");
    });

    it("forgets everything on close", async () => {
        const s = await new Vault(memory(), FAST).create("2468");
        await s.addOne(parseOtpauth(GH));
        s.close();
        expect(s.tokens).toEqual([]);
        await expect(s.records()).rejects.toThrow("Locked");
    });

    it("refuses a damaged record clearly", async () => {
        const store = memory();
        store.setItem(VAULT_KEY, "{not json");
        expect(() => new Vault(store).exists()).toThrow(/damaged/);
    });
});

describe("import and export", () => {
    const aegis = JSON.stringify({
        version: 1, header: { slots: null, params: null },
        db: { version: 2, entries: [
            { type: "totp", uuid: "1", name: "ada@example.org", issuer: "Mastodon", info: { secret: "JBSWY3DPEHPK3PXP", algo: "SHA256", digits: 8, period: 60 } },
            { type: "hotp", uuid: "2", name: "bob", issuer: "VPN", info: { secret: "GEZDGNBVGY3TQOJQ", algo: "SHA1", digits: 6, counter: 5 } },
            { type: "steam", uuid: "3", name: "gamer", issuer: "Steam", info: { secret: "JBSWY3DP", algo: "SHA1", digits: 5, period: 30 } },
            { type: "totp", uuid: "4", name: "broken", issuer: "X", info: { secret: "not base32!", algo: "SHA1", digits: 6, period: 30 } },
        ] },
    });
    const andotp = JSON.stringify([
        { secret: "JBSWY3DPEHPK3PXP", issuer: "Forge", label: "carol", digits: 6, type: "TOTP", algorithm: "SHA1", period: 30, thumbnail: "Default", tags: [] },
        { secret: "GEZDGNBVGY3TQOJQ", label: "Bank:dave", digits: 6, type: "HOTP", algorithm: "SHA512", counter: 3 },
        { secret: "JBSWY3DP", label: "steam", digits: 5, type: "STEAM", algorithm: "SHA1", period: 30 },
    ]);

    it("recognises the formats", () => {
        expect(detect(aegis)).toBe("aegis");
        expect(detect(JSON.stringify({ version: 1, header: { slots: [{}], params: {} }, db: "base64..." }))).toBe("aegis-encrypted");
        expect(detect(andotp)).toBe("andotp");
        expect(detect(`${GH}\n${RFC_HOTP}\n`)).toBe("uris");
        expect(detect("hello")).toBe("unknown");
        expect(isPlaintext("aegis") && isPlaintext("andotp") && isPlaintext("uris")).toBe(true);
        expect(isPlaintext("phoenix")).toBe(false);
    });

    it("reads Aegis plain exports, skipping what it cannot use", () => {
        const r = parseAegis(aegis);
        expect(r.skipped).toBe(2);
        expect(r.tokens.map((t) => [t.type, t.issuer, t.account, t.algorithm, t.digits, t.period, t.counter])).toEqual([
            ["totp", "Mastodon", "ada@example.org", "SHA256", 8, 60, 0],
            ["hotp", "VPN", "bob", "SHA1", 6, 30, 5],
        ]);
    });

    it("reads andOTP plain exports", () => {
        const r = parseAndOtp(andotp);
        expect(r.skipped).toBe(1);
        expect(r.tokens.map((t) => [t.type, t.issuer, t.account, t.algorithm, t.counter])).toEqual([
            ["totp", "Forge", "carol", "SHA1", 0], ["hotp", "Bank", "dave", "SHA512", 3],
        ]);
    });

    it("reads otpauth:// lists and refuses encrypted Aegis vaults with advice", () => {
        expect(parseUriList(`# comment\n${GH}\notpauth://totp/bad?secret=@@\n`)).toMatchObject({ skipped: 1 });
        expect(() => parsePlain(JSON.stringify({ header: { slots: [{}] }, db: "x" }))).toThrow(/export without encryption/);
        expect(() => parsePlain("{}")).toThrow();
    });

    it("round-trips an encrypted backup, and only with its passphrase", async () => {
        const s = await new Vault(memory(), FAST).create("2468");
        await s.add(parseAegis(aegis).tokens);
        const text = await makeBackup(await s.records(), "long backup phrase", FAST);
        expect(text).not.toContain("JBSWY3DPEHPK3PXP");
        expect(text).not.toContain("Mastodon");
        expect(detect(text)).toBe("phoenix");
        expect(JSON.parse(text).format).toBe(BACKUP_FORMAT);
        await expect(readBackup(text, "wrong")).rejects.toBeInstanceOf(SealError);
        const r = await readBackup(text, "long backup phrase");
        expect(r.tokens).toHaveLength(2);
        const other = await new Vault(memory(), FAST).create("1111");
        expect(await other.add(r.tokens)).toBe(2);
        expect(other.tokens.map((t) => t.issuer)).toEqual(["Mastodon", "VPN"]);
    });
});
