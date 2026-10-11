// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The OAuth service's key store on a device: its tokens, refresh tokens and
// client registrations (a Mastodon server's client secret), encrypted at
// rest (docs/SYNERGY-MODERN.md 4.5; docs/SECURITY-APPS.md "What is
// implemented now, and what the device needs").
//
//   <dir>/keys.enc     every record, one JSON object, sealed with
//                      AES-256-GCM: a fresh 96-bit IV on every write, the
//                      store's name as additional data, written to a
//                      temporary file and renamed over the old one; mode 0600
//   <dir>/master.key   the 32-byte data key, made on first use from the
//                      system's random source; mode 0600 in a 0700 folder,
//                      so only the service's user reads it
//
// Where the data key comes from is the one piece to change later: the plan
// is org.webosphoenix.service.keystore (com.palm.keymanager), wrapping the
// key with a device key in a TPM or TEE where the board has one (SYNERGY.md
// 2.9). That service does not exist yet, and there is no device keystore on
// OSE to tie to. The device passcode is no fit either: Synergy syncs in
// the background, before anyone unlocks the device after a restart. So for
// now the key is a file, as SECURITY-APPS.md planned for boards without
// hardware ("else a key file readable only by the service's user"). The
// sealed file records where its key came from ("key": "file"); the key
// store's version unwraps it there and re-seals with "key": "keystore".
// Encrypting still matters with a file key: a copy of keys.enc alone (a
// backup, a sync, a stray copy of /var/lib) opens nothing.
//
// The placeholder before this, keys.json (every record in plain JSON), is
// moved in on first use: sealed into keys.enc, then overwritten with zeros
// and deleted.
//
// wipe() removes the store and its key (the account's sign-out removes its
// own records; Erase removes everything, and without master.key a copy of
// keys.enc is noise).
//
// createFileKeyStore({fs, crypto, path, dir}) -> {get(id), put(id, value),
// del(id), wipe(), all()} -> Promise. A damaged or foreign keys.enc is never
// overwritten: reads and writes fail with errorCode "KEYSTORE_DAMAGED".

"use strict";

var AAD = "org.webosphoenix.service.oauth/keys/v1";
var ALG = "aes-256-gcm";

function createFileKeyStore(o) {
    var fs = o.fs, crypto = o.crypto, path = o.path;
    var dir = o.dir;
    var SEALED = path.join(dir, "keys.enc");
    var KEY = path.join(dir, "master.key");
    var PLAIN = path.join(dir, "keys.json");
    var log = o.log || function () {};

    function damaged(why) {
        return Object.assign(new Error("The key store cannot be read (" + why + ")"), { errorCode: "KEYSTORE_DAMAGED" });
    }

    function ensureDir() {
        fs.mkdirSync(dir, { recursive: true, mode: 448 });
        // An older folder made with a looser mode.
        try { fs.chmodSync(dir, 448); } catch (e) { /* not ours to change */ }
    }

    function writeAtomic(file, data) {
        var tmp = file + ".tmp";
        fs.writeFileSync(tmp, data, { mode: 384 });
        fs.renameSync(tmp, file);
    }

    function dataKey(create) {
        var key = null;
        try { key = fs.readFileSync(KEY); } catch (e) { key = null; }
        if (key && key.length === 32) return key;
        if (key) throw damaged("master.key is not a 256-bit key");
        if (!create) return null;
        ensureDir();
        key = crypto.randomBytes(32);
        // wx: two starts racing do not make two keys.
        try {
            fs.writeFileSync(KEY, key, { mode: 384, flag: "wx" });
        } catch (e) {
            if (e.code !== "EEXIST") throw e;
            return dataKey(false);
        }
        return key;
    }

    function seal(all) {
        var key = dataKey(true);
        var iv = crypto.randomBytes(12);
        var c = crypto.createCipheriv(ALG, key, iv);
        c.setAAD(Buffer.from(AAD, "utf8"));
        var data = Buffer.concat([c.update(Buffer.from(JSON.stringify(all), "utf8")), c.final()]);
        return JSON.stringify({ v: 1, alg: "A256GCM", key: "file", iv: iv.toString("base64"),
                                tag: c.getAuthTag().toString("base64"), data: data.toString("base64") });
    }

    function open(text) {
        var env;
        try { env = JSON.parse(text); } catch (e) { throw damaged("keys.enc is not JSON"); }
        if (!env || env.v !== 1 || env.alg !== "A256GCM" || env.key !== "file") throw damaged("an unknown format");
        var key = dataKey(false);
        if (!key) throw damaged("master.key is missing");
        try {
            var d = crypto.createDecipheriv(ALG, key, Buffer.from(env.iv, "base64"));
            d.setAAD(Buffer.from(AAD, "utf8"));
            d.setAuthTag(Buffer.from(env.tag, "base64"));
            var plain = Buffer.concat([d.update(Buffer.from(env.data, "base64")), d.final()]);
            return JSON.parse(plain.toString("utf8"));
        } catch (e) {
            throw damaged("it does not open with this device's key");
        }
    }

    // Overwrite a file's bytes, then delete it (best effort: a journaling or
    // flash file system may keep old blocks; the sealed store is the
    // protection, this only keeps the plain copy from lying around).
    function shred(file) {
        var size = 0;
        try { size = fs.statSync(file).size; } catch (e) { return; }
        try { fs.writeFileSync(file, Buffer.alloc(size)); } catch (e) { /* removed below anyway */ }
        try { fs.unlinkSync(file); } catch (e) { /* gone */ }
    }

    function migrate() {
        var text;
        try { text = fs.readFileSync(PLAIN, "utf8"); } catch (e) { return null; }
        var all = {};
        try { all = JSON.parse(text) || {}; } catch (e) { all = {}; }
        if (typeof all !== "object" || Array.isArray(all)) all = {};
        ensureDir();
        writeAtomic(SEALED, seal(all));
        shred(PLAIN);
        log("moved " + Object.keys(all).length + " records from keys.json into the sealed store");
        return all;
    }

    function readAll() {
        var text = null;
        try { text = fs.readFileSync(SEALED, "utf8"); } catch (e) { text = null; }
        if (text === null) return migrate() || {};
        var all = open(text);
        // A plain copy left by a migration cut short.
        if (fs.existsSync(PLAIN)) shred(PLAIN);
        return all;
    }

    function writeAll(all) {
        ensureDir();
        writeAtomic(SEALED, seal(all));
    }

    function run(fn) {
        return new Promise(function (resolve) { resolve(fn()); });
    }

    return {
        get: function (id) { return run(function () { return readAll()[id]; }); },
        put: function (id, value) {
            return run(function () { var all = readAll(); all[id] = value; writeAll(all); });
        },
        del: function (id) {
            return run(function () { var all = readAll(); if (id in all) { delete all[id]; writeAll(all); } });
        },
        // Every id (a sign-out's clean-up of an owner's records).
        ids: function () { return run(function () { return Object.keys(readAll()); }); },
        wipe: function () {
            return run(function () {
                [SEALED, SEALED + ".tmp", PLAIN, KEY].forEach(shred);
            });
        },
        files: { sealed: SEALED, key: KEY, plain: PLAIN }
    };
}

module.exports = { createFileKeyStore: createFileKeyStore };
