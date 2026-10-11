// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ed25519 signature verification (RFC 8032, section 5.1.7), for the
// Marketplace's signed catalogs. Verification only: catalogs are signed on
// the server (PHP's libsodium, server/marketplace). Plain BigInt arithmetic
// on extended twisted Edwards coordinates; the check is the cofactored one
// ([8][S]B = [8]R + [8][k]A), as RFC 8032 recommends. Not constant time,
// which verification of public data does not need.
//
// verify(signature, message, publicKey, sha512) -> Promise<boolean>, all
// bytes as Uint8Array; sha512(bytes) -> Promise<Uint8Array> is passed in
// (Node's crypto on a device, WebCrypto in the simulator).

"use strict";

var P = (BigInt(1) << BigInt(255)) - BigInt(19);
var L = (BigInt(1) << BigInt(252)) + BigInt("27742317777372353535851937790883648493");
var N0 = BigInt(0), N1 = BigInt(1), N2 = BigInt(2), N8 = BigInt(8);

function mod(a, m) {
    var r = a % (m || P);
    return r >= N0 ? r : r + (m || P);
}
function pow(b, e) {
    var r = N1;
    b = mod(b);
    while (e > N0) {
        if (e & N1) r = mod(r * b);
        b = mod(b * b);
        e >>= N1;
    }
    return r;
}
function inv(x) { return pow(x, P - N2); }

var D = mod(BigInt(-121665) * inv(BigInt(121666)));
var SQRT_M1 = pow(N2, (P - N1) / BigInt(4));
var B = {
    x: BigInt("15112221349535400772501151409588531511454012693041857206046113283949847762202"),
    y: BigInt("46316835694926478169428394003475163141307993866256225615783033603165251855960")
};
B = { X: B.x, Y: B.y, Z: N1, T: mod(B.x * B.y) };
var ZERO = { X: N0, Y: N1, Z: N1, T: N0 };

// Extended coordinates, a = -1 (add-2008-hwcd-3; dbl-2008-hwcd).
function add(p, q) {
    var a = mod((p.Y - p.X) * (q.Y - q.X));
    var b = mod((p.Y + p.X) * (q.Y + q.X));
    var c = mod(N2 * D * p.T * q.T);
    var d = mod(N2 * p.Z * q.Z);
    var e = b - a, f = d - c, g = d + c, h = b + a;
    return { X: mod(e * f), Y: mod(g * h), Z: mod(f * g), T: mod(e * h) };
}
function double(p) {
    var a = mod(p.X * p.X), b = mod(p.Y * p.Y), c = mod(N2 * p.Z * p.Z);
    var h = a + b, e = h - mod((p.X + p.Y) * (p.X + p.Y)), g = a - b, f = c + g;
    return { X: mod(e * f), Y: mod(g * h), Z: mod(f * g), T: mod(e * h) };
}
function mul(p, n) {
    var r = ZERO, q = p;
    while (n > N0) {
        if (n & N1) r = add(r, q);
        q = double(q);
        n >>= N1;
    }
    return r;
}
function encode(p) {
    var zi = inv(p.Z), x = mod(p.X * zi), y = mod(p.Y * zi);
    var out = new Uint8Array(32);
    for (var i = 0; i < 32; i++) {
        out[i] = Number(y & BigInt(255));
        y >>= BigInt(8);
    }
    if (x & N1) out[31] |= 0x80;
    return out;
}
function le(bytes) {
    var n = N0;
    for (var i = bytes.length - 1; i >= 0; i--) n = (n << BigInt(8)) | BigInt(bytes[i]);
    return n;
}
// RFC 8032 5.1.3; null when the bytes are not a point.
function decode(bytes) {
    if (bytes.length !== 32) return null;
    var b = new Uint8Array(bytes);
    var sign = b[31] >> 7;
    b[31] &= 0x7f;
    var y = le(b);
    if (y >= P) return null;
    var y2 = mod(y * y), u = mod(y2 - N1), v = mod(D * y2 + N1);
    var v3 = mod(v * v * v);
    var x = mod(u * v3 * pow(mod(u * v3 * v3 * v), (P - BigInt(5)) / N8));
    var vx2 = mod(v * x * x);
    if (vx2 !== u) {
        if (vx2 === mod(-u)) x = mod(x * SQRT_M1);
        else return null;
    }
    if (x === N0 && sign) return null;
    if (Number(x & N1) !== sign) x = mod(-x);
    return { X: x, Y: y, Z: N1, T: mod(x * y) };
}
function equal(p, q) {
    return mod(p.X * q.Z) === mod(q.X * p.Z) && mod(p.Y * q.Z) === mod(q.Y * p.Z);
}

function verify(signature, message, publicKey, sha512) {
    try {
        if (!signature || signature.length !== 64 || !publicKey || publicKey.length !== 32) return Promise.resolve(false);
        var A = decode(publicKey), R = decode(signature.subarray(0, 32));
        var S = le(signature.subarray(32, 64));
        if (!A || !R || S >= L) return Promise.resolve(false);
        var data = new Uint8Array(64 + message.length);
        data.set(signature.subarray(0, 32), 0);
        data.set(publicKey, 32);
        data.set(message, 64);
        return Promise.resolve(sha512(data)).then(function (h) {
            var k = mod(le(new Uint8Array(h)), L);
            var left = mul(mul(B, S), N8);
            var right = mul(add(R, mul(A, k)), N8);
            return equal(left, right);
        }, function () { return false; });
    } catch (e) {
        return Promise.resolve(false);
    }
}

module.exports = { verify: verify, _internal: { decode: decode, encode: encode, mul: mul, B: B } };
