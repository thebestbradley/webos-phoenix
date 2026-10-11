// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Staged rollout (PLATFORM.md 6.9, OPEN-QUESTIONS Q56): a release may say
// {"rollout": {"percent": 0-100, "seed": "<text>"}}; a device takes it only
// when its bucket for that seed is below the percentage. The bucket is
// stable per device and release: the first four bytes of
// SHA-256(seed + ":" + the device's rollout id), as a big-endian unsigned
// number, modulo 100. The rollout id is 16 random bytes in hex the device
// makes once and keeps (never sent anywhere), so the server cannot tell
// which devices took a release, and raising the percentage only adds
// devices. No rollout, or percent 100: every device. percent 0: paused.
// docs/PLATFORM-CLIENT.md, "Staged rollout"; the platform must compute
// nothing: it only publishes percent and seed.

"use strict";

var b64 = require("./b64");

function bucket(seed, deviceId, sha256) {
    return Promise.resolve(sha256(b64.utf8(String(seed) + ":" + String(deviceId)))).then(function (h) {
        var b = new Uint8Array(h);
        return ((b[0] * 16777216) + (b[1] << 16) + (b[2] << 8) + b[3]) % 100;
    });
}

// rollout: the release's (or undefined) -> Promise<{eligible, bucket, percent}>
function check(rollout, deviceId, sha256) {
    if (!rollout || typeof rollout !== "object") return Promise.resolve({ eligible: true, bucket: null, percent: 100 });
    var pct = typeof rollout.percent === "number" && isFinite(rollout.percent) ? Math.max(0, Math.min(100, rollout.percent)) : 100;
    if (pct >= 100) return Promise.resolve({ eligible: true, bucket: null, percent: 100 });
    return bucket(typeof rollout.seed === "string" ? rollout.seed : "", deviceId, sha256).then(function (bk) {
        return { eligible: bk < pct, bucket: bk, percent: pct };
    });
}

// A new rollout id: 16 random bytes in hex.
function newId(randomBytes) {
    return b64.hex(randomBytes(16));
}

module.exports = { bucket: bucket, check: check, newId: newId };
