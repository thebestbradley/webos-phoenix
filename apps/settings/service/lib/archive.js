// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The backup file (.pbak): one JSON document, its contents encrypted with a
// key derived from the user's backup passphrase.
//
//   {
//     "format": "org.webosphoenix.backup", "version": 1,
//     "created": "2026-10-01T06:30:00.000Z",
//     "device": {"name": "...", "model": "..."},
//     "parts": [{"id": "com.palm.db", "description": "...", "version": "8"}, ...],
//     "kdf": {"alg": "PBKDF2-SHA256", "iterations": 600000, "salt": "<base64>"},
//     "cipher": {"alg": "AES-256-GCM", "iv": "<base64>"},
//     "payload": "<base64: ciphertext and tag>"
//   }
//
// The header (everything but "payload") is readable without the passphrase,
// so a restore can show what a backup holds and when it was made, and it is
// authenticated: it is the AES-GCM additional data, so changing it makes the
// file fail to open. The payload is the JSON
//
//   {"parts": [{"id", "description", "version", "files": [{"name", "data": "<base64>"}]}]}
//
// i.e. each participant's preBackup answer with the files' contents.
//
// The crypto is passed in (createArchive({crypto})), with this interface,
// all bytes as Uint8Array and all calls returning Promises:
//   randomBytes(n)
//   deriveKey(passphrase, salt, iterations) -> key (opaque)
//   encrypt(key, iv, plaintext, aad) -> ciphertext with the 16-byte tag
//   decrypt(key, iv, ciphertext, aad) -> plaintext; rejects when the key or
//       the data is wrong
// lib/node-crypto.js is the device's (Node's crypto module); the simulator
// gives one on WebCrypto (runtime/phoenix-runtime.js).

"use strict";

var FORMAT = "org.webosphoenix.backup";
var VERSION = 1;
var ITERATIONS = 600000;

function utf8(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    return new Uint8Array(Buffer.from(text, "utf8"));
}
function fromUtf8(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString("utf8");
}

var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes) {
    var out = "", i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
        var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < bytes.length) {
        var m = bytes[i] << 16 | (i + 1 < bytes.length ? bytes[i + 1] << 8 : 0);
        out += B64[m >> 18] + B64[(m >> 12) & 63] + (i + 1 < bytes.length ? B64[(m >> 6) & 63] : "=") + "=";
    }
    return out;
}
function fromBase64(text) {
    var s = String(text).replace(/[^A-Za-z0-9+/]/g, "");
    var out = new Uint8Array(Math.floor(s.length * 3 / 4)), o = 0, buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
        buf = (buf << 6) | B64.indexOf(s[i]);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[o++] = (buf >> bits) & 255;
        }
    }
    return out.subarray(0, o);
}

function fail(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}

// The header without the payload, in a fixed key order: the additional
// data both sides authenticate.
function headerOf(file) {
    return {
        format: file.format, version: file.version, created: file.created, device: file.device,
        parts: file.parts, kdf: file.kdf, cipher: file.cipher
    };
}
function aadOf(file) {
    return utf8(JSON.stringify(headerOf(file)));
}

// Read a backup file's text: the parsed file, or an error with code
// "NOT_A_BACKUP" / "NEWER_VERSION".
function parse(text) {
    var file;
    try {
        file = JSON.parse(typeof text === "string" ? text : fromUtf8(text));
    } catch (e) {
        throw fail("NOT_A_BACKUP", "This is not a Phoenix backup file");
    }
    if (!file || file.format !== FORMAT || typeof file.payload !== "string" || !file.kdf || !file.cipher)
        throw fail("NOT_A_BACKUP", "This is not a Phoenix backup file");
    if (file.version > VERSION)
        throw fail("NEWER_VERSION", "This backup was made by a newer version of Phoenix");
    return file;
}

function createArchive(opts) {
    var crypto = opts.crypto;

    // A key for a passphrase, with its salt: kept by the service for
    // automatic backups, so the passphrase itself is not stored.
    function makeKey(passphrase, salt, iterations) {
        iterations = iterations || ITERATIONS;
        var s = salt ? Promise.resolve(salt) : crypto.randomBytes(16);
        return s.then(function (saltBytes) {
            return crypto.deriveKey(passphrase, saltBytes, iterations).then(function (key) {
                return { key: key, salt: saltBytes, iterations: iterations };
            });
        });
    }

    // parts: [{id, description, version, files: [{name, data: Uint8Array}]}]
    // -> the file's text.
    function seal(keyInfo, parts, meta) {
        return crypto.randomBytes(12).then(function (iv) {
            var file = {
                format: FORMAT, version: VERSION,
                created: (meta && meta.created) || new Date().toISOString(),
                device: (meta && meta.device) || {},
                parts: parts.map(function (p) { return { id: p.id, description: p.description || "", version: p.version || "" }; }),
                kdf: { alg: "PBKDF2-SHA256", iterations: keyInfo.iterations, salt: toBase64(keyInfo.salt) },
                cipher: { alg: "AES-256-GCM", iv: toBase64(iv) }
            };
            var body = utf8(JSON.stringify({ parts: parts.map(function (p) {
                return { id: p.id, description: p.description || "", version: p.version || "",
                         files: p.files.map(function (f) { return { name: f.name, data: toBase64(f.data) }; }) };
            }) }));
            return crypto.encrypt(keyInfo.key, iv, body, aadOf(file)).then(function (ct) {
                file.payload = toBase64(ct);
                return JSON.stringify(file);
            });
        });
    }

    // The file's text and the passphrase -> {header, parts: [{id, description,
    // version, files: [{name, data: Uint8Array}]}]}; rejects with code
    // "WRONG_PASSPHRASE" when it does not open.
    function open(text, passphrase) {
        var file;
        try { file = parse(text); } catch (e) { return Promise.reject(e); }
        if (file.kdf.alg !== "PBKDF2-SHA256" || file.cipher.alg !== "AES-256-GCM")
            return Promise.reject(fail("NOT_A_BACKUP", "Unknown encryption in this backup"));
        return crypto.deriveKey(passphrase, fromBase64(file.kdf.salt), file.kdf.iterations).then(function (key) {
            return crypto.decrypt(key, fromBase64(file.cipher.iv), fromBase64(file.payload), aadOf(file)).then(null, function () {
                throw fail("WRONG_PASSPHRASE", "The passphrase is wrong, or the file is damaged");
            });
        }).then(function (plain) {
            var body = JSON.parse(fromUtf8(plain));
            return {
                header: headerOf(file),
                parts: (body.parts || []).map(function (p) {
                    return { id: p.id, description: p.description, version: p.version,
                             files: (p.files || []).map(function (f) { return { name: f.name, data: fromBase64(f.data) }; }) };
                })
            };
        });
    }

    return { makeKey: makeKey, seal: seal, open: open };
}

module.exports = {
    FORMAT: FORMAT, VERSION: VERSION, ITERATIONS: ITERATIONS,
    createArchive: createArchive, parse: parse, headerOf: headerOf,
    toBase64: toBase64, fromBase64: fromBase64, utf8: utf8, fromUtf8: fromUtf8
};
