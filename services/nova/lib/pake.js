// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Pairing's password-authenticated key exchange (docs/DEV-PUSH.md 6.4):
// SPAKE2 as RFC 9382 specifies it, ciphersuite SPAKE2-P256-SHA256-HKDF-HMAC,
// keyed by the six-digit code the device shows.
//
// Why a PAKE: a six-digit code is a million guesses. A plain proof keyed
// with it (an HMAC of the fingerprints) would let anyone who poses as the
// device during pairing take that proof away and try every code offline.
// With SPAKE2 a party learns whether one code is right only by running the
// protocol with the real other party, one code per run; the device ends the
// pairing window after five failed runs.
//
// Where the parts come from: there is no vetted, permissively licensed
// SPAKE2 or CPace package for JavaScript (November 2026). The group
// operations, which are the hard part to get right (point decoding and
// validation, constant-time scalar multiplication), are @noble/curves'
// P-256 (MIT, audited; already in the image for the drives' SSH client);
// SHA-256, HKDF, HMAC, scrypt and the random scalars are Node's own crypto
// (OpenSSL). What is written here is RFC 9382's protocol on top of those:
// pA = x*P + w*M, pB = y*P + w*N, K = h*x*(pB - w*N) = h*y*(pA - w*M) (h is
// 1 on P-256), the transcript TT, Ke || Ka = SHA-256(TT), KcA || KcB =
// HKDF(Ka, nil, "ConfirmationKeys" || AAD, 32), cA = HMAC(KcA, TT), cB =
// HMAC(KcB, TT). It is checked against the RFC's four test vectors
// (Appendix B) in pake.test.ts, as an independent check of this code.
//
// How nova uses it (lib/proto.js): A is the computer, B the device; their
// identities are "nova:" and "novad:" with the fingerprints of the keys each
// presented in the TLS handshake, and the AAD is the TLS connection's
// exported keying material (RFC 8446 7.5, label "EXPORTER-nova-pair"), so a
// run is bound to the two keys and to the one TLS connection it ran over: a
// party in the middle has two TLS connections with two different exporters
// and two different sets of keys, and can complete neither run without the
// code. w = scrypt(code, salt) reduced mod the group order with 64 extra
// bits (RFC 9382 3.2; NIST SP 800-56A), the salt both fingerprints.

"use strict";

var crypto = require("crypto");
var p256 = require("@noble/curves/p256").p256;

var Point = p256.ProjectivePoint;
var ORDER = p256.CURVE.n;
// RFC 9382 section 6, for P-256 (compressed SEC1).
var M = Point.fromHex("02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f");
var N = Point.fromHex("03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49");
var SCALAR_BYTES = 32;

function fail(text) {
    var e = new Error(text);
    e.code = "PAKE_FAILED";
    return e;
}

function toBig(bytes) { return BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0")); }
function fromBig(n, size) {
    var hex = n.toString(16);
    return Buffer.from(hex.padStart(size * 2, "0"), "hex");
}
// len(x) || x, len an eight-byte little-endian number (RFC 9382 3.1).
function lp(bytes) {
    var l = Buffer.alloc(8);
    l.writeBigUInt64LE(BigInt(bytes.length));
    return Buffer.concat([l, Buffer.from(bytes)]);
}

// A uniform scalar in [1, n): rejection sampling (RFC 9382 7).
function randomScalar() {
    for (;;) {
        var s = toBig(crypto.randomBytes(SCALAR_BYTES));
        if (s > 0n && s < ORDER) return s;
    }
}

// The six-digit code -> w, scrypt (N 2^15, r 8, p 1: about 30 ms) over the
// code with the run's identities as the salt, 40 bytes reduced mod n.
function passwordScalar(code, salt) {
    var out = crypto.scryptSync(Buffer.from(String(code), "utf8"), Buffer.from(salt), SCALAR_BYTES + 8,
                                { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    var w = toBig(out) % ORDER;
    return w === 0n ? 1n : w;
}

// A received element: decoded (uncompressed SEC1) and checked to be on the
// curve and not the identity (RFC 9382 7: "MUST abort").
function decode(bytes) {
    var p;
    try { p = Point.fromHex(Buffer.from(bytes).toString("hex")); } catch (e) { throw fail("not a point on P-256"); }
    if (p.equals(Point.ZERO)) throw fail("the identity element");
    p.assertValidity();
    return p;
}

function keySchedule(A, B, pA, pB, K, w, aad) {
    var TT = Buffer.concat([lp(Buffer.from(A)), lp(Buffer.from(B)), lp(pA), lp(pB), lp(K), lp(fromBig(w, SCALAR_BYTES))]);
    var h = crypto.createHash("sha256").update(TT).digest();
    var Ke = h.subarray(0, 16), Ka = h.subarray(16);
    var kc = Buffer.from(crypto.hkdfSync("sha256", Ka, Buffer.alloc(0), Buffer.concat([Buffer.from("ConfirmationKeys"), Buffer.from(aad || [])]), 32));
    var KcA = kc.subarray(0, 16), KcB = kc.subarray(16);
    return {
        TT: TT, Ke: Ke, Ka: Ka, KcA: KcA, KcB: KcB,
        cA: crypto.createHmac("sha256", KcA).update(TT).digest(),
        cB: crypto.createHmac("sha256", KcB).update(TT).digest()
    };
}

function equal(a, b) {
    a = Buffer.from(a); b = Buffer.from(b);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// One party's run. role "A" (the computer) or "B" (the device); opts:
// {w (bigint; else code and salt), A, B (identities, strings or bytes), aad
// (bytes), x (bigint: the RFC's test vectors only)}.
//   start() -> the element to send (pA or pB), uncompressed SEC1 bytes
//   finish(theirs) -> {Ke, confirm (this party's MAC to send), expect}
//   verify(mac) -> true when the other party's MAC is right (constant time)
function party(role, opts) {
    if (role !== "A" && role !== "B") throw new Error("role: A or B");
    var w = opts.w !== undefined ? BigInt(opts.w) : passwordScalar(opts.code, opts.salt);
    var x = opts.x !== undefined ? BigInt(opts.x) : randomScalar();
    var mine = Point.BASE.multiply(x).add((role === "A" ? M : N).multiply(w));
    var mineBytes = Buffer.from(mine.toRawBytes(false));
    var keys = null, used = false;
    return {
        start: function () { return mineBytes; },
        finish: function (theirsBytes) {
            if (used) throw fail("a run is used once");
            used = true;
            var theirs = decode(theirsBytes);
            var K = theirs.subtract((role === "A" ? N : M).multiply(w)).multiply(x);
            if (K.equals(Point.ZERO)) throw fail("the shared element is the identity");
            var Kb = Buffer.from(K.toRawBytes(false));
            var pA = role === "A" ? mineBytes : Buffer.from(theirsBytes);
            var pB = role === "A" ? Buffer.from(theirsBytes) : mineBytes;
            keys = keySchedule(opts.A || "", opts.B || "", pA, pB, Kb, w, opts.aad);
            return { Ke: keys.Ke, K: Kb, TT: keys.TT, confirm: role === "A" ? keys.cA : keys.cB };
        },
        verify: function (mac) {
            if (!keys) throw fail("finish() first");
            return equal(mac, role === "A" ? keys.cB : keys.cA);
        }
    };
}

module.exports = { party: party, passwordScalar: passwordScalar, keySchedule: keySchedule, M: M, N: N, ORDER: ORDER,
                   _internal: { lp: lp, fromBig: fromBig } };
