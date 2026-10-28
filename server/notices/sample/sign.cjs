#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulator's sample notices feed (docs/NOTICES.md; server/notices/README.md):
// writes public/notices.json from notices.sample.json and signs it with
// signing.key, the sample key, as the platform signs the real feed: a
// detached Ed25519 signature of the file's exact bytes, base64, then a
// newline (notices.json.sig). The key is in git on purpose, as
// server/drivers/sample/signing.key is: it signs nothing else, and only the
// simulator's servers.json pins it.
//
//   node server/notices/sample/sign.cjs           write and sign
//   node server/notices/sample/sign.cjs --check   the files are what it would write
//
// signing.key: base64 of libsodium's 64-byte secret key (the 32-byte seed,
// then the public key), the format server/drivers' sample key has.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

function privateKey() {
    const raw = Buffer.from(fs.readFileSync(path.join(DIR, "signing.key"), "utf8").trim(), "base64");
    if (raw.length !== 64) throw new Error("signing.key is not a 64-byte Ed25519 secret key");
    const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, raw.subarray(0, 32)]), format: "der", type: "pkcs8" });
    const pub = Buffer.from(crypto.createPublicKey(key).export({ format: "jwk" }).x, "base64url");
    if (!pub.equals(raw.subarray(32))) throw new Error("signing.key's public half is not its seed's");
    return { key, publicKey: pub.toString("base64") };
}

function main(argv) {
    const k = privateKey();
    const doc = JSON.parse(fs.readFileSync(path.join(DIR, "notices.sample.json"), "utf8"));
    delete doc["//"];
    const bytes = Buffer.from(JSON.stringify(doc, null, 2) + "\n", "utf8");
    const sig = crypto.sign(null, bytes, k.key).toString("base64") + "\n";
    const out = path.join(DIR, "public");
    if (argv.includes("--check")) {
        const same = fs.readFileSync(path.join(out, "notices.json")).equals(bytes)
            && crypto.verify(null, bytes, crypto.createPublicKey(k.key), Buffer.from(fs.readFileSync(path.join(out, "notices.json.sig"), "utf8").trim(), "base64"));
        console.log(same ? "notices sample: up to date (key " + k.publicKey + ")" : "notices sample: run node server/notices/sample/sign.cjs");
        return same ? 0 : 1;
    }
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "notices.json.sig"), sig);   // the signature first, then the file (as the platform publishes)
    fs.writeFileSync(path.join(out, "notices.json"), bytes);
    console.log("notices sample: signed with " + k.publicKey);
    return 0;
}

process.exitCode = main(process.argv.slice(2));
