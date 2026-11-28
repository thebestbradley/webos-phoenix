// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The computer's nova key (docs/DEV-PUSH.md 6.4): an Ed25519 key pair made
// on first use, ~/.config/nova/key (PKCS #8 PEM, readable by its owner
// only) and key.pub ("ed25519:<base64 of the 32-byte public key>"). It
// signs dev bundles; P2 pairs it with devices, and its public half is the
// developer's identity on the server channel. $XDG_CONFIG_HOME/nova when
// that is set; --key FILE names another.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

function configDir() {
    const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(base, "nova");
}

function defaultKeyFile() {
    return path.join(configDir(), "key");
}

function rawPublic(publicKey) {
    // The SubjectPublicKeyInfo of an Ed25519 key ends with its 32 bytes.
    const der = publicKey.export({ type: "spki", format: "der" });
    return der.subarray(der.length - 32);
}

function fingerprint(raw) {
    return "SHA256:" + crypto.createHash("sha256").update(raw).digest("base64").replace(/=+$/, "");
}

// file -> {file, privateKey, publicKey (base64), id ("ed25519:<base64>"),
// fingerprint, made (true when it was made now)}. Makes the pair when the
// file is not there and create is not false.
function load(file, create) {
    file = file || defaultKeyFile();
    let made = false;
    if (!fs.existsSync(file)) {
        if (create === false) throw Object.assign(new Error("No nova key at " + file), { code: "NO_KEY" });
        const pair = crypto.generateKeyPairSync("ed25519");
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
        fs.writeFileSync(file + ".pub", "ed25519:" + rawPublic(pair.publicKey).toString("base64") + "\n", { mode: 0o644 });
        made = true;
    }
    const st = fs.statSync(file);
    if (process.platform !== "win32" && (st.mode & 0o077)) {
        throw Object.assign(new Error(file + " can be read by others (chmod 600 " + file + ")"), { code: "KEY_MODE" });
    }
    const privateKey = crypto.createPrivateKey(fs.readFileSync(file));
    if (privateKey.asymmetricKeyType !== "ed25519") throw Object.assign(new Error(file + " is not an Ed25519 key"), { code: "NOT_ED25519" });
    const raw = rawPublic(crypto.createPublicKey(privateKey));
    const b64 = raw.toString("base64");
    return { file, privateKey, publicKey: b64, id: "ed25519:" + b64, fingerprint: fingerprint(raw), made };
}

// The detached signature of bytes, as every Phoenix feed's .sig holds it:
// base64 of the Ed25519 signature, then a newline.
function signDetached(bytes, key) {
    return crypto.sign(null, bytes, key.privateKey).toString("base64") + "\n";
}

// The same key for TLS (lib/proto.js of org.webosphoenix.nova): with the
// self-signed certificate that carries it there.
function forTls(key) {
    const tlsKeys = require("../../../services/nova/lib/keys.js");
    return tlsKeys.fromPem(key.privateKey.export({ type: "pkcs8", format: "pem" }), "nova");
}

// The key in OpenSSH's own format ("openssh-key-v1", unencrypted), for
// nova term's ssh: written beside the key as key.ssh, readable by its
// owner only. -> its path
function sshKeyFile(key) {
    const out = key.file + ".ssh";
    const der = key.privateKey.export({ type: "pkcs8", format: "der" });
    const seed = der.subarray(der.length - 32);
    const pub = Buffer.from(key.publicKey, "base64");
    const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    const str = (b) => Buffer.concat([u32(b.length), Buffer.from(b)]);
    const type = Buffer.from("ssh-ed25519");
    const pubBlob = Buffer.concat([str(type), str(pub)]);
    const check = crypto.randomBytes(4);
    let priv = Buffer.concat([check, check, str(type), str(pub), str(Buffer.concat([seed, pub])), str(Buffer.from("nova"))]);
    const pad = [];
    for (let i = 1; (priv.length + pad.length) % 8 !== 0; i++) pad.push(i);
    priv = Buffer.concat([priv, Buffer.from(pad)]);
    const body = Buffer.concat([Buffer.from("openssh-key-v1\0"), str(Buffer.from("none")), str(Buffer.from("none")), str(Buffer.alloc(0)),
                                u32(1), str(pubBlob), str(priv)]);
    const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\n" + body.toString("base64").replace(/(.{70})/g, "$1\n").replace(/\n?$/, "\n") +
                "-----END OPENSSH PRIVATE KEY-----\n";
    fs.writeFileSync(out, pem, { mode: 0o600 });
    fs.chmodSync(out, 0o600);
    return out;
}

module.exports = { configDir, defaultKeyFile, load, signDetached, fingerprint, forTls, sshKeyFile };
