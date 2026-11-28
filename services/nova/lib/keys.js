// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// nova's keys and their certificates (docs/DEV-PUSH.md 6.4), for both ends:
// the computer's (tools/nova/lib/keys.cjs keeps it in ~/.config/nova/key)
// and the device's (novad's, /var/lib/phoenix/nova/device-key). Each is an
// Ed25519 key pair; its identity is the raw 32-byte public key, written
// "ed25519:<base64>", and its fingerprint "SHA256:<base64 of SHA-256 of
// it>" (as OpenSSH prints one).
//
// TLS needs a certificate for a key, so each side wraps its key in a
// self-signed X.509 certificate made here (Node has no API that writes
// one). Nothing checks these certificates as a CA would: each side pins
// the other's public key (pairing stored it), and the certificate is only
// how TLS 1.3 carries the key and proves its holder signed the handshake
// (CertificateVerify). So the certificate is the smallest one TLS takes:
// version 3, a serial, Ed25519 (RFC 8410), a common name, a validity that
// does not expire in practice, no extensions.

"use strict";

var crypto = require("crypto");

// The 32 bytes of an Ed25519 public KeyObject (its SubjectPublicKeyInfo
// ends with them).
function rawPublic(publicKey) {
    var der = publicKey.export({ type: "spki", format: "der" });
    return der.subarray(der.length - 32);
}

function fingerprint(raw) {
    if (typeof raw === "string") raw = Buffer.from(raw.replace(/^ed25519:/, ""), "base64");
    return "SHA256:" + crypto.createHash("sha256").update(raw).digest("base64").replace(/=+$/, "");
}

// A base64 raw Ed25519 public key (with or without "ed25519:") -> KeyObject.
var SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function publicKeyObject(b64) {
    var raw = Buffer.from(String(b64).replace(/^ed25519:/, ""), "base64");
    if (raw.length !== 32) throw new Error("not an Ed25519 public key");
    return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

// ---- DER, as much as a certificate needs ----------------------------------------------

function len(n) {
    if (n < 0x80) return Buffer.from([n]);
    var bytes = [];
    while (n > 0) { bytes.unshift(n & 0xff); n = Math.floor(n / 256); }
    return Buffer.from([0x80 | bytes.length].concat(bytes));
}
function tlv(tag, body) { return Buffer.concat([Buffer.from([tag]), len(body.length), body]); }
function seq() { return tlv(0x30, Buffer.concat(Array.prototype.slice.call(arguments))); }
function set(x) { return tlv(0x31, x); }
// DER's INTEGER is minimal: no leading zero byte unless the next has its
// high bit set (a serial starting 00 7f... is "illegal padding" to OpenSSL).
function int(bytes) {
    var b = Buffer.from(bytes);
    var i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    b = b.subarray(i);
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    return tlv(0x02, b);
}
var OID_ED25519 = Buffer.from("06032b6570", "hex");          // 1.3.101.112
var OID_CN = Buffer.from("0603550403", "hex");               // 2.5.4.3
function name(cn) { return seq(set(seq(OID_CN, tlv(0x0c, Buffer.from(cn, "utf8"))))); }
function time(d) {
    // GeneralizedTime, as RFC 5280 asks for dates from 2050 on.
    var s = d.toISOString().replace(/[-:T]/g, "").replace(/\.\d+Z$/, "Z");
    return tlv(0x18, Buffer.from(s, "ascii"));
}

// {privateKey, publicKey: KeyObject?, cn} -> PEM of a self-signed certificate.
function selfSigned(privateKey, cn) {
    var pub = crypto.createPublicKey(privateKey);
    var spki = pub.export({ type: "spki", format: "der" });
    var serial = crypto.createHash("sha256").update(spki).digest().subarray(0, 16);
    serial[0] = (serial[0] & 0x7f) | 0x40;   // positive, 16 bytes
    var alg = seq(OID_ED25519);
    var tbs = seq(
        tlv(0xa0, int([2])),                                       // version 3
        int(serial),
        alg,
        name(cn),
        seq(time(new Date(Date.UTC(2026, 0, 1))), time(new Date(Date.UTC(9999, 11, 31, 23, 59, 59)))),
        name(cn),
        spki
    );
    var sig = crypto.sign(null, tbs, privateKey);
    var der = seq(tbs, alg, tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
    return "-----BEGIN CERTIFICATE-----\n" + der.toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n?$/, "\n") +
           "-----END CERTIFICATE-----\n";
}

// A peer certificate (tls.TLSSocket#getPeerX509Certificate()) -> its base64
// raw Ed25519 public key, or null when it is not an Ed25519 certificate.
function peerKey(x509) {
    if (!x509 || !x509.publicKey || x509.publicKey.asymmetricKeyType !== "ed25519") return null;
    return rawPublic(x509.publicKey).toString("base64");
}

// A PEM private key -> {privateKey, publicKey (base64), id, fingerprint, cert}.
function fromPem(pem, cn) {
    var privateKey = crypto.createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("not an Ed25519 key");
    var raw = rawPublic(crypto.createPublicKey(privateKey));
    var b64 = raw.toString("base64");
    return { privateKey: privateKey, pem: privateKey.export({ type: "pkcs8", format: "pem" }), publicKey: b64,
             id: "ed25519:" + b64, fingerprint: fingerprint(raw), cert: selfSigned(privateKey, cn || "nova") };
}

function generate(cn) {
    var pair = crypto.generateKeyPairSync("ed25519");
    return fromPem(pair.privateKey.export({ type: "pkcs8", format: "pem" }), cn);
}

// The OpenSSH form of a public key ("ssh-ed25519 AAAA... comment"), for
// the device's authorized_keys (nova term).
function sshPublic(b64, comment) {
    var raw = Buffer.from(String(b64).replace(/^ed25519:/, ""), "base64");
    var type = Buffer.from("ssh-ed25519");
    var u32 = function (n) { var b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    var blob = Buffer.concat([u32(type.length), type, u32(raw.length), raw]);
    return "ssh-ed25519 " + blob.toString("base64") + (comment ? " " + comment : "");
}

module.exports = { rawPublic: rawPublic, fingerprint: fingerprint, publicKeyObject: publicKeyObject, selfSigned: selfSigned,
                   peerKey: peerKey, fromPem: fromPem, generate: generate, sshPublic: sshPublic };
