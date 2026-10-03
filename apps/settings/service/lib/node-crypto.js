// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// lib/archive.js's crypto on a device: Node's crypto module (PBKDF2-SHA256,
// AES-256-GCM), which every Node.js OSE ships has (WebCrypto may not).

"use strict";

var crypto = require("crypto");

module.exports = {
    randomBytes: function (n) {
        return Promise.resolve(new Uint8Array(crypto.randomBytes(n)));
    },
    deriveKey: function (passphrase, salt, iterations) {
        return new Promise(function (resolve, reject) {
            crypto.pbkdf2(Buffer.from(String(passphrase), "utf8"), Buffer.from(salt), iterations, 32, "sha256", function (err, key) {
                if (err) reject(err); else resolve(new Uint8Array(key));
            });
        });
    },
    encrypt: function (key, iv, plaintext, aad) {
        var c = crypto.createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
        c.setAAD(Buffer.from(aad));
        var out = Buffer.concat([c.update(Buffer.from(plaintext)), c.final(), c.getAuthTag()]);
        return Promise.resolve(new Uint8Array(out));
    },
    decrypt: function (key, iv, data, aad) {
        try {
            var buf = Buffer.from(data);
            var d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
            d.setAAD(Buffer.from(aad));
            d.setAuthTag(buf.subarray(buf.length - 16));
            return Promise.resolve(new Uint8Array(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()])));
        } catch (e) {
            return Promise.reject(e);
        }
    },
    // The derived key kept for automatic backups, as text.
    exportKey: function (key) { return Promise.resolve(Buffer.from(key).toString("base64")); },
    importKey: function (text) { return Promise.resolve(new Uint8Array(Buffer.from(text, "base64"))); }
};
