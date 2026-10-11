// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Signed feeds: a file and its detached signature (<file>.sig: base64 of
// the Ed25519 signature of the file's exact bytes, then a newline), as the
// catalog's index.json has had from the start (server/marketplace
// Catalog::publish), now also the update feed (format 2) and the
// revocation list. docs/PLATFORM-CLIENT.md, "Signatures and keys".
//
// Which key: a feed's key.json names its online key. A device that pins
// the feed's key ("key" in servers.json) takes only that key; one that
// pins the offline root ("root") takes the online key only with a
// delegation the root signed, for that feed ("scope"), not expired
// (PLATFORM.md 7.1 step 2, OPEN-QUESTIONS Q45; TUF's idea):
//
//   key.json  {"key": "<online key>", "name", "fingerprint",
//              "delegations": [{"scope": "catalog" | "updates" | "drivers",
//                               "key": "<online key>", "issued", "expires",
//                               "signature": "<base64, by the root>"}]}
//
// The root signs the UTF-8 bytes of
//   "phoenix-key-delegation:1\n" + scope + "\n" + key + "\n" + issued + "\n" + expires + "\n"
// (a fixed text, so no JSON canonical form is needed on either side). Two
// delegations may be listed while the online key changes; the index is
// signed by one of them. A key in the signed revocation list's "keys" is
// never taken again, whatever signed it.

"use strict";

var ed25519 = require("./ed25519");
var b64 = require("./b64");

var DELEGATION_PREFIX = "phoenix-key-delegation:1\n";

function err(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}

function delegationMessage(d) {
    return b64.utf8(DELEGATION_PREFIX + d.scope + "\n" + d.key + "\n" + d.issued + "\n" + d.expires + "\n");
}

// bytes (Uint8Array), signature (base64 text), key (base64) -> Promise<bool>
function verifyDetached(bytes, signatureB64, keyB64, sha512) {
    var sig = b64.fromBase64(String(signatureB64 || "").trim());
    var key = b64.fromBase64(String(keyB64 || ""));
    if (sig.length !== 64 || key.length !== 32) return Promise.resolve(false);
    return ed25519.verify(sig, bytes, key, sha512);
}

// A feed's key.json and what the device pins -> Promise<[the online keys
// it may take]>. pin: {key, root}; scope: the feed's; now: Date;
// revokedKeys: base64 keys never to take.
function trustedKeys(keyJson, pin, scope, opts) {
    var revoked = (opts && opts.revokedKeys) || [];
    var now = ((opts && opts.now) || new Date()).getTime();
    var sha512 = opts.sha512;
    if (pin && pin.key) {
        if (revoked.indexOf(pin.key) >= 0) return Promise.reject(err("REVOKED_KEY", "The pinned " + scope + " key was revoked"));
        return Promise.resolve([pin.key]);
    }
    if (!pin || !pin.root) return Promise.resolve(null);   // nothing pinned: the caller decides
    var list = keyJson && (Array.isArray(keyJson.delegations) ? keyJson.delegations : keyJson.delegation ? [keyJson.delegation] : []);
    if (!list || !list.length) return Promise.reject(err("NO_DELEGATION", "The " + scope + " key is not delegated by the root key this device trusts"));
    var reasons = [];
    return list.slice(0, 4).reduce(function (chain, d) {
        return chain.then(function (good) {
            if (!d || d.scope !== scope || typeof d.key !== "string" || typeof d.issued !== "string" || typeof d.expires !== "string") {
                reasons.push("a delegation for " + (d && d.scope));
                return good;
            }
            var exp = Date.parse(d.expires);
            if (!(exp > now)) { reasons.push("a delegation that expired on " + d.expires); return good; }
            if (b64.fromBase64(d.key).length !== 32) { reasons.push("a delegation without a key"); return good; }
            if (revoked.indexOf(d.key) >= 0) { reasons.push("a revoked key"); return good; }
            return verifyDetached(delegationMessage(d), d.signature, pin.root, sha512).then(function (ok) {
                if (ok) good.push(b64.toBase64(b64.fromBase64(d.key)));
                else reasons.push("a delegation the root key did not sign");
                return good;
            });
        });
    }, Promise.resolve([])).then(function (good) {
        if (!good.length) throw err("NO_DELEGATION", "The " + scope + " key is not delegated by the root key this device trusts (" + reasons.join("; ") + ")");
        return good;
    });
}

// The file verifies with any of keys -> Promise<the key> | rejects BAD_SIGNATURE.
function verifyWithAny(bytes, signatureB64, keys, sha512, what) {
    return keys.reduce(function (chain, k) {
        return chain.then(function (found) {
            if (found) return found;
            return verifyDetached(bytes, signatureB64, k, sha512).then(function (ok) { return ok ? k : null; });
        });
    }, Promise.resolve(null)).then(function (k) {
        if (!k) throw err("BAD_SIGNATURE", "The " + (what || "feed") + "'s signature does not match its key");
        return k;
    });
}

module.exports = { DELEGATION_PREFIX: DELEGATION_PREFIX, delegationMessage: delegationMessage, verifyDetached: verifyDetached,
                   trustedKeys: trustedKeys, verifyWithAny: verifyWithAny };
