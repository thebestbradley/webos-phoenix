// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Your own AirPods by their keys (the owner, 15 October 2026; docs/
// ACCESSORIES.md, "Your AirPods' keys"). Paired AirPods give the device
// that asks two keys over their control channel (aap.js
// requestProximityKeys): an identity resolving key (IRK) and an encryption
// key. With them Phoenix knows which advertisement nearby is the user's
// own AirPods, and can read the encrypted part of it.
//
//   - The IRK resolves the advertisement's random address: a resolvable
//     private address is 24 bits of random (prand, its two top bits 0b01)
//     and a 24-bit hash; it belongs to the key when ah(IRK, prand) equals
//     the hash, where ah(k, r) is AES-128 of r (padded with 13 zero bytes
//     in front) under k, its last three bytes (Bluetooth Core Specification,
//     Vol 6 Part B §1.3.2.2 and §1.3.2.3; Vol 3 Part H §2.2.2; its sample
//     data for ah in Vol 3 Part H Appendix D: k ec0234a3 57c8ad05 341010a6
//     0a397d9b, r 708194, ah 0dfbaa, which keys.test.ts checks).
//     That AirPods' advertisements use such an address, resolved by this
//     IRK, is CAPod's documentation ("AirPod Keys": the IRK links the
//     randomized addresses), not Apple's; the byte order in which the
//     AirPods send the key is not documented, so both orders are tried
//     (UNVERIFIED).
//   - The encryption key opens the last 16 bytes of the Proximity Pairing
//     message (continuity.js "encrypted"): "the decryption / encryption is
//     done using AES with ECB mode" (tyalie/AAP-Protocol-Defintion,
//     FINDINGS.md); it holds the batteries at 1 % (CAPod's "AirPod Keys":
//     "more accurate battery levels (e.g., 1% steps instead of 10%)";
//     Heinze, Classen & Hollick, "MagicPairing", WiSec 2020, §4.3: the
//     encrypted part encodes battery state, under a "MagicPairing
//     EncryptionKey"). Where in the 16 bytes each battery is, no source
//     documents: Phoenix learns it from the AirPods themselves (createLearner
//     below), comparing what it decrypts with the batteries the control
//     channel reports at the same time, and reads the advertisement's
//     batteries only once that is settled. Until then, and without keys,
//     the advertisement's own tenths are used, and AirPods are matched by
//     model (earbuds.js).

"use strict";

var crypto = require("crypto");

function toBytes(x) {
    if (!x) return [];
    if (typeof x === "string") {
        var hex = x.replace(/[^0-9a-f]/gi, ""), r = [];
        for (var i = 0; i + 1 < hex.length; i += 2) r.push(parseInt(hex.substr(i, 2), 16));
        return r;
    }
    return Array.prototype.slice.call(x).map(function (v) { return Number(v) & 0xff; });
}
function hex(b) { return toBytes(b).map(function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join(""); }

function aes(key, block, decrypt) {
    var c = decrypt ? crypto.createDecipheriv("aes-128-ecb", Buffer.from(key), null)
                    : crypto.createCipheriv("aes-128-ecb", Buffer.from(key), null);
    c.setAutoPadding(false);
    return Array.prototype.slice.call(Buffer.concat([c.update(Buffer.from(block)), c.final()]));
}

// ah(k, r): the random address hash function (Vol 3 Part H §2.2.2).
function ah(irk, prand) {
    var k = toBytes(irk), r = toBytes(prand);
    if (k.length !== 16 || r.length !== 3) return null;
    var e = aes(k, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].concat(r));
    return e.slice(13);
}

// "AA:BB:CC:DD:EE:FF" (most significant byte first, as bluetooth2 gives
// addresses) as six bytes.
function addressBytes(address) {
    var b = toBytes(String(address || ""));
    return b.length === 6 ? b : null;
}

// Is it a resolvable private address (the two top bits 0b01)?
function isResolvable(address) {
    var a = addressBytes(address);
    return !!a && (a[0] >> 6) === 1;
}

// Does the address resolve with this IRK? "" if not, else the key's byte
// order that did: "as sent" or "reversed".
function resolves(irk, address) {
    var a = addressBytes(address), k = toBytes(irk);
    if (!a || (a[0] >> 6) !== 1 || k.length !== 16) return "";
    var want = hex(a.slice(3));
    if (hex(ah(k, a.slice(0, 3))) === want) return "as sent";
    if (hex(ah(k.slice().reverse(), a.slice(0, 3))) === want) return "reversed";
    return "";
}

// The encrypted part opened with the key, in both byte orders: {"as sent":
// [16], reversed: [16]}, or null.
function decrypt(encKey, block) {
    var k = toBytes(encKey), b = toBytes(block);
    if (k.length !== 16 || b.length !== 16) return null;
    return { "as sent": aes(k, b, true), reversed: aes(k.slice().reverse(), b, true) };
}

// ---- Where the batteries are -------------------------------------------------------
// A learner, per pair of AirPods. Each sample: what decrypt() gave, and the
// batteries the control channel reports at the time ({left, right, case},
// percent, -1 none). For each key order and each battery, the positions
// whose low seven bits held that battery in every sample so far stay
// candidates (the top bit is left out: charging may be there). Only new
// observations count (the same bytes with the same batteries again add
// nothing). It is settled when, in one key order, left and right each have
// one position, not the same, after at least three observations, in which
// left and right differed at least once (so equal levels cannot pass for a
// layout) and the batteries changed at least once (so a byte that matched
// by chance has had to match again); the case's position is kept if it too
// is down to one. Nothing is guessed: if the bytes hold the batteries some
// other way, nothing settles, and the advertisement's tenths stay in use.
var MIN_SAMPLES = 3;

function createLearner(state) {
    var st = state && typeof state === "object" ? JSON.parse(JSON.stringify(state))
        : { samples: 0, differed: false, levels: [], last: "", candidates: {}, layout: null };
    function positions(bytes, level) {
        var out = [];
        if (typeof level !== "number" || level < 0 || level > 100) return null;
        for (var i = 0; i < bytes.length; ++i) if ((bytes[i] & 0x7f) === level) out.push(i);
        return out;
    }
    function keep(old, now) {
        if (now === null) return old;               // no reading this time
        if (old === undefined) return now;
        return old.filter(function (i) { return now.indexOf(i) >= 0; });
    }
    return {
        state: function () { return JSON.parse(JSON.stringify(st)); },
        layout: function () { return st.layout; },
        sample: function (opened, battery) {
            if (st.layout || !opened || !battery) return st.layout;
            if (!(battery.left >= 0 && battery.right >= 0)) return null;
            var seen = hex(opened["as sent"] || []) + "/" + battery.left + "/" + battery.right + "/" + battery.case;
            if (seen === st.last) return null;
            st.last = seen;
            st.samples++;
            if (battery.left !== battery.right) st.differed = true;
            var lr = battery.left + "/" + battery.right;
            if (st.levels.indexOf(lr) < 0 && st.levels.length < 8) st.levels.push(lr);
            ["as sent", "reversed"].forEach(function (order) {
                var bytes = opened[order];
                if (!bytes) return;
                var c = st.candidates[order] = st.candidates[order] || {};
                ["left", "right", "case"].forEach(function (k) { c[k] = keep(c[k], positions(bytes, battery[k])); });
            });
            if (st.samples < MIN_SAMPLES || !st.differed || st.levels.length < 2) return null;
            ["as sent", "reversed"].forEach(function (order) {
                var c = st.candidates[order];
                if (st.layout || !c || !c.left || !c.right || c.left.length !== 1 || c.right.length !== 1 || c.left[0] === c.right[0])
                    return;
                st.layout = { order: order, left: c.left[0], right: c.right[0],
                              case: c.case && c.case.length === 1 && c.case[0] !== c.left[0] && c.case[0] !== c.right[0] ? c.case[0] : -1 };
            });
            return st.layout;
        }
    };
}

// The batteries in an opened advertisement, by a settled layout:
// {left, right, case} (percent, -1 none), or null.
function batteries(opened, layout) {
    if (!opened || !layout || !opened[layout.order]) return null;
    var b = opened[layout.order];
    var at = function (i) {
        if (i < 0) return -1;
        var v = b[i] & 0x7f;
        return v <= 100 ? v : -1;
    };
    return { left: at(layout.left), right: at(layout.right), case: at(layout.case) };
}

module.exports = {
    ah: ah, resolves: resolves, isResolvable: isResolvable, decrypt: decrypt,
    createLearner: createLearner, batteries: batteries, hex: hex, toBytes: toBytes, MIN_SAMPLES: MIN_SAMPLES
};
