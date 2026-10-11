// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// SSH keys: the public key blobs and signatures of RFC 4253 6.6, RFC 5656
// (ECDSA), RFC 8332 (RSA with SHA-2) and RFC 8709 (Ed25519); OpenSSH's
// public key lines ("ssh-ed25519 AAAA... comment") and fingerprints
// ("SHA256:" and the unpadded Base64 of the blob's SHA-256, as ssh-keygen
// -l prints them); private keys in OpenSSH's format (PROTOCOL.key,
// "openssh-key-v1": what ssh-keygen writes since 7.8, and what Phoenix keeps
// in the key store), and imported from the PEM formats older tools write:
// PKCS #1 RSA, PKCS #8 (Ed25519, RSA) and SEC 1 (ECDSA).
//
// A key protected by a passphrase is refused with errorCode
// KEY_ENCRYPTED (bcrypt-pbkdf is not here: docs/OPEN-QUESTIONS.md); its
// owner makes a copy without one (ssh-keygen -p -N "" -f copy) for the
// device, which keeps it sealed in its key store.

"use strict";

var W = require("./wire");
var C = require("./crypto");

function keyError(message, code) {
    var e = new Error(message);
    e.errorCode = code || "KEY_INVALID";
    return e;
}

var ECDSA = { "ecdsa-sha2-nistp256": "nistp256", "ecdsa-sha2-nistp384": "nistp384" };
// The signature algorithms each key type signs with, best first.
var SIG_ALGS = {
    "ssh-ed25519": ["ssh-ed25519"],
    "ssh-rsa": ["rsa-sha2-512", "rsa-sha2-256"],
    "ecdsa-sha2-nistp256": ["ecdsa-sha2-nistp256"],
    "ecdsa-sha2-nistp384": ["ecdsa-sha2-nistp384"]
};
// The key type of a signature (host key) algorithm.
function keyTypeOf(alg) { return alg === "rsa-sha2-256" || alg === "rsa-sha2-512" ? "ssh-rsa" : alg; }

// ---- Public keys --------------------------------------------------------------------------

function publicBlob(key) {
    var w = new W.Writer().string(key.type);
    if (key.type === "ssh-ed25519") w.string(key.pub);
    else if (key.type === "ssh-rsa") w.mpint(key.e).mpint(key.n);
    else if (ECDSA[key.type]) w.string(ECDSA[key.type]).string(key.Q);
    else throw keyError("Not a key type Phoenix knows: " + key.type, "KEY_UNSUPPORTED");
    return w.bytes();
}

function parsePublicBlob(blob) {
    var r = new W.Reader(blob);
    var type = W.latin1(r.string());
    if (type === "ssh-ed25519") {
        var pub = r.string();
        if (pub.length !== 32) throw keyError("An Ed25519 key is 32 bytes");
        return { type: type, pub: pub };
    }
    if (type === "ssh-rsa") {
        var e = W.toBigInt(r.mpint()), n = W.toBigInt(r.mpint());
        return { type: type, e: e, n: n };
    }
    if (ECDSA[type]) {
        var curve = W.latin1(r.string());
        if (curve !== ECDSA[type]) throw keyError("The ECDSA key's curve is not its type's");
        return { type: type, Q: r.string() };
    }
    throw keyError("Not a key type Phoenix knows: " + type, "KEY_UNSUPPORTED");
}

function fingerprint(blob) {
    return "SHA256:" + W.base64(C.sha256(blob)).replace(/=+$/, "");
}

// "ED25519", "RSA 3072", "ECDSA 256": what ssh-keygen -l says of a key.
function describe(blob) {
    var k = parsePublicBlob(blob);
    if (k.type === "ssh-ed25519") return "ED25519";
    if (k.type === "ssh-rsa") return "RSA " + k.n.toString(2).length;
    return "ECDSA " + ECDSA[k.type].replace("nistp", "");
}

function publicKeyLine(keyOrBlob, comment) {
    var blob = keyOrBlob instanceof Uint8Array ? keyOrBlob : publicBlob(keyOrBlob);
    var type = W.latin1(new W.Reader(blob).string());
    var c = comment !== undefined ? comment : keyOrBlob.comment;
    return type + " " + W.base64(blob) + (c ? " " + c : "");
}

function parsePublicKeyLine(line) {
    var m = /^\s*(\S+)\s+([A-Za-z0-9+/=]+)(?:\s+(.*))?$/.exec(String(line || ""));
    if (!m) throw keyError("Not a public key line");
    var blob = W.fromBase64(m[2]);
    var k = parsePublicBlob(blob);
    if (k.type !== m[1]) throw keyError("The key line's type is not its key's");
    return { blob: blob, type: k.type, comment: m[3] || "" };
}

// ---- Signatures ---------------------------------------------------------------------------

// blob: the signer's public key; sigBlob: string alg, string signature.
function verify(blob, sigBlob, data, alg) {
    var key = parsePublicBlob(blob);
    var r = new W.Reader(sigBlob);
    var sigAlg = W.latin1(r.string());
    var sig = r.string();
    if (alg && sigAlg !== alg) return false;
    if (keyTypeOf(sigAlg) !== key.type) return false;
    if (key.type === "ssh-ed25519") return sig.length === 64 && C.ed25519.verify(key.pub, data, sig);
    if (key.type === "ssh-rsa") {
        if (sigAlg !== "rsa-sha2-256" && sigAlg !== "rsa-sha2-512") return false;
        return C.rsaVerify(key, sigAlg === "rsa-sha2-512" ? "sha512" : "sha256", data, sig);
    }
    var sr = new W.Reader(sig);
    var rr = sr.mpint(), ss = sr.mpint();
    return C.ecdsaVerify(ECDSA[key.type], key.Q, data, rr, ss);
}

// A private key's signature (string alg, string signature) of data.
function sign(key, data, alg) {
    alg = alg || SIG_ALGS[key.type][0];
    var sig;
    if (key.type === "ssh-ed25519") sig = C.ed25519.sign(key.seed, data);
    else if (key.type === "ssh-rsa") sig = C.rsaSign(key, alg === "rsa-sha2-512" ? "sha512" : "sha256", data);
    else if (ECDSA[key.type]) {
        var c = C.CURVES[ECDSA[key.type]];
        var s = c.curve.sign(C.hash(c.hash, data), key.d);
        sig = new W.Writer().mpint(s.r).mpint(s.s).bytes();
    } else throw keyError("Not a key type Phoenix can sign with: " + key.type, "KEY_UNSUPPORTED");
    return new W.Writer().string(alg).string(sig).bytes();
}

// ---- Private keys: OpenSSH's format ----------------------------------------------------------

var MAGIC = W.utf8("openssh-key-v1\0");

function armor(label, bytes) {
    var b = W.base64(bytes), lines = [];
    for (var i = 0; i < b.length; i += 70) lines.push(b.slice(i, i + 70));
    return "-----BEGIN " + label + "-----\n" + lines.join("\n") + "\n-----END " + label + "-----\n";
}

function dearmor(text) {
    var m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(String(text || ""));
    if (!m) return null;
    var body = m[2];
    var headers = {};
    // RFC 1421 headers (Proc-Type: 4,ENCRYPTED) before a blank line.
    if (/^\s*[A-Za-z-]+:/m.test(body.split(/\r?\n\r?\n/)[0]) && /\r?\n\r?\n/.test(body)) {
        var parts = body.split(/\r?\n\r?\n/);
        parts[0].split(/\r?\n/).forEach(function (l) { var i = l.indexOf(":"); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
        body = parts.slice(1).join("\n");
    }
    return { label: m[1], headers: headers, bytes: W.fromBase64(body) };
}

function formatPrivateKey(key) {
    var pub = publicBlob(key);
    var check = C.randomBytes(4);
    var w = new W.Writer().raw(check).raw(check).string(key.type);
    if (key.type === "ssh-ed25519") w.string(key.pub).string(W.concat([key.seed, key.pub]));
    else if (key.type === "ssh-rsa") {
        var qi = key.qi || C.modPow(key.q, key.p - BigInt(2), key.p);
        w.mpint(key.n).mpint(key.e).mpint(key.d).mpint(qi).mpint(key.p).mpint(key.q);
    } else w.string(ECDSA[key.type]).string(key.Q).mpint(key.d);
    w.string(key.comment || "");
    for (var i = 1; w.len % 8; i++) w.byte(i);
    var out = new W.Writer().raw(MAGIC).string("none").string("none").string("").uint32(1).string(pub).string(w.bytes());
    return armor("OPENSSH PRIVATE KEY", out.bytes());
}

function parseOpenSsh(bytes) {
    if (!W.equal(bytes.subarray(0, MAGIC.length), MAGIC)) throw keyError("Not an OpenSSH private key");
    var r = new W.Reader(bytes, MAGIC.length);
    var cipher = W.latin1(r.string()), kdf = W.latin1(r.string());
    r.string();
    if (cipher !== "none" || kdf !== "none")
        throw keyError("The key is protected with a passphrase. Make a copy without one for this device (ssh-keygen -p -N \"\" -f copy-of-key)", "KEY_ENCRYPTED");
    var n = r.uint32();
    if (n !== 1) throw keyError("The file holds " + n + " keys; Phoenix takes one");
    var pubBlob = r.string();
    var p = new W.Reader(r.string());
    if (p.uint32() !== p.uint32()) throw keyError("The key is damaged (its check numbers differ)");
    var type = W.latin1(p.string());
    var key;
    if (type === "ssh-ed25519") {
        var pub = p.string(), sk = p.string();
        if (pub.length !== 32 || sk.length !== 64) throw keyError("The Ed25519 key is damaged");
        key = { type: type, seed: sk.slice(0, 32), pub: pub.slice() };
    } else if (type === "ssh-rsa") {
        var nn = W.toBigInt(p.mpint()), e = W.toBigInt(p.mpint()), d = W.toBigInt(p.mpint());
        var qi = W.toBigInt(p.mpint()), pp = W.toBigInt(p.mpint()), q = W.toBigInt(p.mpint());
        key = { type: type, n: nn, e: e, d: d, qi: qi, p: pp, q: q };
    } else if (ECDSA[type]) {
        var curve = W.latin1(p.string());
        if (curve !== ECDSA[type]) throw keyError("The ECDSA key's curve is not its type's");
        key = { type: type, Q: p.string().slice(), d: p.mpint().slice() };
    } else {
        throw keyError("Phoenix does not take " + type + " keys (Ed25519, RSA and ECDSA are taken)", "KEY_UNSUPPORTED");
    }
    key.comment = W.fromUtf8(p.string());
    if (!W.equal(publicBlob(key), pubBlob)) throw keyError("The key's public half is not its private half's");
    return key;
}

// ---- Private keys: DER (PKCS #1, PKCS #8, SEC 1) ---------------------------------------------

function der(bytes) {
    var pos = 0;
    function item() {
        if (pos + 2 > bytes.length) throw keyError("The key's DER ends too soon");
        var tag = bytes[pos++], len = bytes[pos++];
        if (len & 0x80) {
            var n = len & 0x7f;
            if (n < 1 || n > 4) throw keyError("A DER length Phoenix does not take");
            len = 0;
            for (var i = 0; i < n; i++) len = len * 256 + bytes[pos++];
        }
        if (pos + len > bytes.length) throw keyError("The key's DER ends too soon");
        var body = bytes.subarray(pos, pos + len);
        pos += len;
        return { tag: tag, body: body };
    }
    var out = [];
    while (pos < bytes.length) out.push(item());
    return out;
}
function seq(body) { return der(body); }
function int(x) { if (x.tag !== 2) throw keyError("Expected an INTEGER in the key"); return W.toBigInt(x.body); }
function oid(x) {
    if (x.tag !== 6) throw keyError("Expected an OID in the key");
    var b = x.body, parts = [Math.floor(b[0] / 40), b[0] % 40], v = 0;
    for (var i = 1; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { parts.push(v); v = 0; } }
    return parts.join(".");
}

function rsaFromPkcs1(body) {
    var f = seq(der(body)[0].body);
    if (f.length < 9) throw keyError("Not an RSA private key");
    return { type: "ssh-rsa", n: int(f[1]), e: int(f[2]), d: int(f[3]), p: int(f[4]), q: int(f[5]), dp: int(f[6]), dq: int(f[7]), qi: int(f[8]) };
}

var CURVE_OIDS = { "1.2.840.10045.3.1.7": "ecdsa-sha2-nistp256", "1.3.132.0.34": "ecdsa-sha2-nistp384" };

function ecFromSec1(body, curveOid) {
    var f = seq(der(body)[0].body);
    var d = f[1].body.slice();
    var named = curveOid;
    var Q = null;
    f.slice(2).forEach(function (x) {
        if (x.tag === 0xa0) named = oid(der(x.body)[0]);
        if (x.tag === 0xa1) { var bits = der(x.body)[0]; Q = bits.body.slice(1); }
    });
    var type = CURVE_OIDS[named];
    if (!type) throw keyError("Phoenix takes ECDSA keys on P-256 and P-384 only", "KEY_UNSUPPORTED");
    if (!Q) Q = C.CURVES[ECDSA[type]].curve.getPublicKey(d, false);
    return { type: type, d: d, Q: Q };
}

function fromPkcs8(body) {
    var f = seq(der(body)[0].body);
    var alg = seq(f[1].body);
    var id = oid(alg[0]);
    var inner = f[2].body;
    if (id === "1.3.101.112") {
        var seed = der(inner)[0].body.slice();
        if (seed.length !== 32) throw keyError("The Ed25519 key is damaged");
        return { type: "ssh-ed25519", seed: seed, pub: C.ed25519.publicOf(seed) };
    }
    if (id === "1.2.840.113549.1.1.1") return rsaFromPkcs1(inner);
    if (id === "1.2.840.10045.2.1") return ecFromSec1(inner, oid(alg[1]));
    throw keyError("Phoenix does not take this kind of key (" + id + ")", "KEY_UNSUPPORTED");
}

/** A private key from its text (any of the formats above) -> {type, ..., comment}. */
function parsePrivateKey(text) {
    var a = dearmor(text);
    if (!a) {
        if (/^\s*PuTTY-User-Key-File/.test(String(text || "")))
            throw keyError("This is a PuTTY key: export it in OpenSSH's format (PuTTYgen: Conversions > Export OpenSSH key)", "KEY_UNSUPPORTED");
        if (/^\s*(ssh-|ecdsa-)/.test(String(text || ""))) throw keyError("This is a public key; the private key is needed (the file without .pub)");
        throw keyError("Not a private key");
    }
    if (a.headers["Proc-Type"] && /ENCRYPTED/.test(a.headers["Proc-Type"]))
        throw keyError("The key is protected with a passphrase. Make a copy without one for this device (ssh-keygen -p -N \"\" -f copy-of-key)", "KEY_ENCRYPTED");
    var key;
    if (a.label === "OPENSSH PRIVATE KEY") return parseOpenSsh(a.bytes);
    if (a.label === "RSA PRIVATE KEY") key = rsaFromPkcs1(a.bytes);
    else if (a.label === "PRIVATE KEY") key = fromPkcs8(a.bytes);
    else if (a.label === "EC PRIVATE KEY") key = ecFromSec1(a.bytes, null);
    else if (a.label === "ENCRYPTED PRIVATE KEY")
        throw keyError("The key is protected with a passphrase. Make a copy without one for this device (ssh-keygen -p -N \"\" -f copy-of-key)", "KEY_ENCRYPTED");
    else throw keyError("Not a private key (" + a.label.toLowerCase() + ")");
    if (key.type === "ssh-rsa" && key.n.toString(2).length < 2048) throw keyError("RSA keys shorter than 2048 bits are refused", "KEY_UNSUPPORTED");
    key.comment = "";
    // The public half checked against the private (a damaged or mixed-up file).
    if (key.type === "ssh-rsa" && C.modPow(C.modPow(BigInt(2), key.e, key.n), key.d, key.n) !== BigInt(2)) throw keyError("The RSA key is damaged");
    return key;
}

/** A new Ed25519 key (made on the device). */
function generateEd25519(comment) {
    var k = C.ed25519.generate();
    return { type: "ssh-ed25519", seed: k.seed, pub: k.pub, comment: comment || "" };
}

module.exports = {
    publicBlob: publicBlob, parsePublicBlob: parsePublicBlob, fingerprint: fingerprint, describe: describe, publicKeyLine: publicKeyLine,
    parsePublicKeyLine: parsePublicKeyLine, verify: verify, sign: sign, formatPrivateKey: formatPrivateKey, parsePrivateKey: parsePrivateKey,
    generateEd25519: generateEd25519, SIG_ALGS: SIG_ALGS, keyTypeOf: keyTypeOf, ECDSA: ECDSA
};
