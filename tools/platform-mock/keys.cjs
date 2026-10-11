// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Test keys and signatures as the platform makes them (docs/PLATFORM-CLIENT.md,
// "Signatures and keys"; docs/platform-api/README.md): Ed25519 with Node's
// crypto, detached signatures of a file's exact bytes in base64 followed by
// a newline, and the offline root's delegation of an online key. Used by
// the mock platform (server.cjs) and the device services' unit tests. Real
// keys are never made here: these are thrown away with the test.

"use strict";

const crypto = require("crypto");

const DELEGATION_PREFIX = "phoenix-key-delegation:1\n";

// A key pair: {publicKey (base64 of the 32 raw bytes), fingerprint, sign(bytes) -> base64}
function keypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
    return {
        publicKey: raw.toString("base64"),
        fingerprint: fingerprint(raw),
        privateKey,
        sign: (bytes) => crypto.sign(null, Buffer.from(bytes), privateKey).toString("base64")
    };
}

// As the device shows it (apps/marketplace/service/lib/catalog.js fingerprint;
// server/marketplace Signer::fingerprint): the first 16 bytes of SHA-256 of
// the key, hex, upper case, groups of 4.
function fingerprint(raw) {
    return crypto.createHash("sha256").update(raw).digest().subarray(0, 16).toString("hex").toUpperCase().match(/.{4}/g).join(" ");
}

// The text a root signs to delegate scope to key until expires.
function delegationText(d) {
    return DELEGATION_PREFIX + d.scope + "\n" + d.key + "\n" + d.issued + "\n" + d.expires + "\n";
}

function delegate(root, online, scope, issued, expires) {
    const d = { scope, key: online.publicKey, issued, expires };
    d.signature = root.sign(Buffer.from(delegationText(d), "utf8"));
    return d;
}

// The detached signature file's body.
function sigFile(key, bytes) {
    return key.sign(bytes) + "\n";
}

module.exports = { DELEGATION_PREFIX, keypair, fingerprint, delegationText, delegate, sigFile };
