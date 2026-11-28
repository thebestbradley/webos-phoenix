// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.oauth: OAuth 2.0 sign-ins for Synergy
// connectors (docs/SYNERGY-CONNECTORS.md 4.1, docs/SYNERGY-MODERN.md 4.4),
// the part the Fediverse connector needs (phase C2): the authorization
// code flow with PKCE (RFC 7636, S256) in a system browser sheet, tokens
// kept in the key store, never handed to a page.
//
//   authorize {authorizationEndpoint, tokenEndpoint, clientId, clientSecret?,
//              scope, redirectUri?, revocationEndpoint?, owner?}
//       shows the provider's sign-in page in the browser sheet (its address
//       bar visible; the caller cannot read the page), waits for the
//       redirect, checks `state`, exchanges the code with the PKCE
//       verifier, and keeps the tokens under a new key:
//       -> {keyId, scope, tokenType} or errorCode "CANCELED" (the user
//       closed the sheet or the card), "ACCESS_DENIED" (refused on the
//       provider's page), "401_UNAUTHORIZED" (the code was not accepted),
//       "TIMEOUT" (nothing came back for ten minutes), "BAD_PARAMS" (a
//       redirect this device cannot receive)
//   token {keyId, refresh?} -> {accessToken, tokenType, expiresAt} (refreshed
//                              when it has expired and a refresh token is kept;
//                              refresh: true renews it now, when the provider
//                              refused the one kept before it expired here: a
//                              clock that differs, a token revoked; Home
//                              Assistant's frontend asks so, getExternalAuth
//                              {force})
//   forget {keyId}          revokes the token (RFC 7009, when the provider
//                           has an endpoint) and deletes the key
//   client {name, value?}   a client registration the caller keeps here
//                           (Mastodon's per-server client id and secret,
//                           SYNERGY-MODERN.md 4.4: "the per-device client
//                           secret goes into the key store"); value null
//                           deletes it
//   redirectUri {}          -> {redirectUri, fixedRedirectUri}: where this
//                              device's sign-ins come back to, for a client
//                              registration. On a device redirectUri is the
//                              RFC 8252 loopback address without a port
//                              (http://127.0.0.1/oauth/callback: each sign-in
//                              listens on an ephemeral port, for providers
//                              that match loopback redirects on any port),
//                              fixedRedirectUri the same with the service's
//                              fixed port (for providers that match exactly:
//                              docs/DEVELOPER-APPS.md); in the simulator's
//                              sheet both are its signed-in.html
//   pending {session}       the Sign In card's page only: the address of
//                           the sign-in it was launched for (signincard.js)
//   wipe {}                 the system only (Erase): every key and client
//                           registration, and the store's own key
//
// Keys belong to their owner: the service that asked (owner defaults to
// the caller; a connector's sign-in page may name the service its template
// names, mayActFor). Only the owner reads, refreshes or forgets them.
//
// Written against injected pieces, so the same file runs on a device
// (service.js, device.js) and in the simulator (runtime/phoenix-runtime.js,
// "OAuth"):
//   request({method, url, headers, body}) -> {status, headers, body}
//   keystore {get(id), put(id, record), del(id), wipe?()} -> Promise
//   redirect(requested, {state}) -> Promise<{redirectUri, result?, close()}>
//       optional: where this sign-in's redirect comes back to, made for it
//       (device.js: the loopback listener, loopback.js); without it the
//       requested address is used as it is
//   sheet(url, redirectUri, pending) -> Promise<the redirect address | null>
//       shows the provider's page (the simulator's sheet; on a device the
//       Sign In card, signincard.js, which also ends on pending.result);
//       may reject with errorCode "TIMEOUT"
//   card {pending(p, caller)}  optional: the Sign In card's question
//   crypto {randomBytes(n) -> Uint8Array, sha256(bytes) -> Promise<Uint8Array>}
//   redirectUri, fixedRedirectUri  the addresses above
//   mayActFor(caller, owner) -> bool, mayWipe(caller) -> bool, now(), log()

"use strict";

function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    var b = typeof btoa === "function" ? btoa(s) : Buffer.from(s, "latin1").toString("base64");
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, "utf8"));
}

function form(o) {
    return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null && o[k] !== ""; })
        .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&");
}

function queryOf(url) {
    var out = {};
    var q = String(url).replace(/#.*$/, "").split("?")[1] || "";
    q.split("&").forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf("=");
        var k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, " "));
        out[k] = i < 0 ? "" : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
    });
    return out;
}

function fail(code, text) { return { returnValue: false, errorCode: code, errorText: text }; }
function ok(extra) { return Object.assign({ returnValue: true }, extra || {}); }

var METHODS = ["authorize", "token", "forget", "client", "redirectUri", "pending", "wipe"];

function createOAuthService(env) {
    var log = env.log || function () {};
    var now = env.now || function () { return Date.now(); };
    var mayActFor = env.mayActFor || function (caller, owner) { return caller === owner; };

    var keyOperations = Object.create(null);
    var storeWrites = Promise.resolve();
    var generation = 0;
    var wiping = null;

    function erased() { return Object.assign(new Error("The key store was erased"), { errorCode: "NOT_FOUND" }); }
    function current(expected) { if (expected !== generation) throw erased(); }
    function ready() {
        if (wiping) throw Object.assign(new Error("The key store is being erased"), { errorCode: "BUSY" });
    }
    // Order asynchronous storage mutations as well as network operations.
    // Wipe advances the generation before queuing its deletion, so an old
    // authorization/refresh reply cannot recreate a key afterwards.
    function storeMutation(task, expected) {
        var result = storeWrites.then(function () {
            current(expected);
            return Promise.resolve(task()).then(function (value) { current(expected); return value; });
        });
        storeWrites = result.then(function () {}, function () {});
        return result;
    }
    function keyState(key) {
        return keyOperations[key] || (keyOperations[key] = { tail: Promise.resolve(), count: 0, token: null, forgetting: null });
    }
    function ordered(key, slot, task) {
        slot.count++;
        var result = slot.tail.then(task);
        slot.tail = result.then(function () {}, function () {});
        function finish() {
            slot.count--;
            if (!slot.count && keyOperations[key] === slot) delete keyOperations[key];
        }
        return result.then(function (value) { finish(); return value; }, function (e) { finish(); throw e; });
    }

    function ownerOf(p, caller) {
        var owner = p.owner || caller;
        if (!owner) throw Object.assign(new Error("Who is asking is not known"), { errorCode: "PERMISSION_DENIED" });
        if (owner !== caller && !mayActFor(caller, owner)) throw Object.assign(new Error(caller + " may not sign in for " + owner), { errorCode: "PERMISSION_DENIED" });
        return owner;
    }

    function postToken(endpoint, params) {
        return Promise.resolve(env.request({
            method: "POST", url: endpoint,
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: form(params)
        })).then(function (res) {
            var body = null;
            try { body = JSON.parse(res.body || "null"); } catch (e) { body = null; }
            if (res.status !== 200 || !body || !body.access_token) {
                var e = new Error("The token endpoint answered " + res.status + (body && body.error ? " (" + body.error + ")" : ""));
                e.errorCode = res.status === 400 || res.status === 401 ? "401_UNAUTHORIZED" : res.status >= 500 ? "500_SERVER_ERROR" : "UNKNOWN_ERROR";
                throw e;
            }
            return body;
        });
    }

    function keep(rec, body) {
        rec.accessToken = String(body.access_token);
        rec.tokenType = String(body.token_type || "Bearer");
        if (body.refresh_token) rec.refreshToken = String(body.refresh_token);
        rec.scope = String(body.scope || rec.scope || "");
        rec.expiresAt = body.expires_in ? now() + Number(body.expires_in) * 1000 : 0;
        return rec;
    }

    function owned(p, caller) {
        if (!p.keyId) return Promise.reject(Object.assign(new Error("keyId is required"), { errorCode: "BAD_PARAMS" }));
        return Promise.resolve(env.keystore.get("key:" + p.keyId)).then(function (rec) {
            if (!rec) throw Object.assign(new Error("No such key"), { errorCode: "NOT_FOUND" });
            if (rec.owner !== caller) throw Object.assign(new Error("Not this caller's key"), { errorCode: "PERMISSION_DENIED" });
            return rec;
        });
    }

    function wrap(promise) {
        return promise.then(function (r) { return r; }, function (e) {
            return fail(e.errorCode || "UNKNOWN_ERROR", String(e && e.message || e));
        });
    }

    return {
        redirectUri: function () {
            return Promise.resolve(ok({ redirectUri: env.redirectUri, fixedRedirectUri: env.fixedRedirectUri || env.redirectUri }));
        },

        pending: function (p, caller) {
            if (!env.card) return Promise.resolve(fail("UNSUPPORTED", "No Sign In card here"));
            return wrap(Promise.resolve(env.card.pending(p || {}, caller)));
        },

        wipe: function (p, caller) {
            return wrap(Promise.resolve().then(function () {
                if (!env.mayWipe || !env.mayWipe(caller)) throw Object.assign(new Error("Only the system erases the key store"), { errorCode: "PERMISSION_DENIED" });
                if (!env.keystore.wipe) throw Object.assign(new Error("This key store cannot be wiped"), { errorCode: "UNSUPPORTED" });
                if (wiping) return wiping;
                generation++;
                log("wiping the key store");
                var result = storeMutation(function () { return env.keystore.wipe(); }, generation);
                wiping = result.then(function () { wiping = null; return ok(); }, function (e) { wiping = null; throw e; });
                return wiping;
            }));
        },

        authorize: function (p, caller) {
            return wrap(Promise.resolve().then(function () {
                ready();
                var expected = generation;
                var owner = ownerOf(p, caller);
                ["authorizationEndpoint", "tokenEndpoint", "clientId"].forEach(function (k) {
                    if (!/^https?:\/\//.test(String(p[k] || "")) && k !== "clientId") throw Object.assign(new Error(k + " must be an http(s) address"), { errorCode: "BAD_PARAMS" });
                    if (!p[k]) throw Object.assign(new Error(k + " is required"), { errorCode: "BAD_PARAMS" });
                });
                var redirectUri = p.redirectUri || env.redirectUri;
                var verifier = b64url(env.crypto.randomBytes(32));
                var state = b64url(env.crypto.randomBytes(16));
                var pending = null;
                var done = function () { if (pending && pending.close) pending.close(); };
                return Promise.resolve(env.redirect ? env.redirect(redirectUri, { state: state }) : { redirectUri: redirectUri }).then(function (pd) {
                    pending = pd;
                    redirectUri = pd.redirectUri;
                    return env.crypto.sha256(utf8(verifier));
                }).then(function (digest) {
                    var url = p.authorizationEndpoint + (p.authorizationEndpoint.indexOf("?") < 0 ? "?" : "&") + form(Object.assign({
                        response_type: "code", client_id: p.clientId, redirect_uri: redirectUri, scope: p.scope || "",
                        state: state, code_challenge: b64url(digest), code_challenge_method: "S256"
                    }, p.params || {}));
                    log("sign-in for " + owner + " at " + url.replace(/\?.*$/, ""));
                    return env.sheet(url, redirectUri, pending);
                }).then(function (back) { done(); return back; }, function (e) { done(); throw e; }).then(function (back) {
                    if (!back) throw Object.assign(new Error("The sign-in was closed"), { errorCode: "CANCELED" });
                    var q = queryOf(back);
                    if (q.state !== state) throw Object.assign(new Error("The answer is not of this sign-in (state)"), { errorCode: "401_UNAUTHORIZED" });
                    if (q.error) throw Object.assign(new Error(q.error_description || q.error), { errorCode: q.error === "access_denied" ? "ACCESS_DENIED" : "401_UNAUTHORIZED" });
                    if (!q.code) throw Object.assign(new Error("No code in the answer"), { errorCode: "401_UNAUTHORIZED" });
                    return postToken(p.tokenEndpoint, {
                        grant_type: "authorization_code", code: q.code, redirect_uri: redirectUri, client_id: p.clientId,
                        client_secret: p.clientSecret, code_verifier: verifier
                    });
                }).then(function (body) {
                    var keyId = b64url(env.crypto.randomBytes(18));
                    var rec = keep({ owner: owner, tokenEndpoint: p.tokenEndpoint, revocationEndpoint: p.revocationEndpoint || "",
                                     clientId: p.clientId, clientSecret: p.clientSecret || "", created: now() }, body);
                    return storeMutation(function () { return env.keystore.put("key:" + keyId, rec); }, expected).then(function () {
                        return ok({ keyId: keyId, scope: rec.scope, tokenType: rec.tokenType });
                    });
                });
            }));
        },

        token: function (p, caller) {
            var expected = generation;
            // Check ownership before sharing a result; another caller must
            // never join the owner's in-flight refresh or disconnect.
            return wrap(owned(p, caller).then(function (initial) {
                ready(); current(expected);
                var slot = keyState(p.keyId);
                if (slot.forgetting) throw Object.assign(new Error("This key is being disconnected"), { errorCode: "NOT_FOUND" });
                if (slot.token && (p.refresh !== true || slot.refresh)) return slot.token;
                slot.refresh = !!initial.refreshToken && (p.refresh === true ||
                    (initial.expiresAt && initial.expiresAt - 60000 <= now()));
                slot.token = ordered(p.keyId, slot, function () {
                    current(expected);
                    return owned(p, caller).then(function (rec) {
                        current(expected);
                        var fresh = !rec.expiresAt || rec.expiresAt - 60000 > now();
                        function reply() { return ok({ accessToken: rec.accessToken, tokenType: rec.tokenType, expiresAt: rec.expiresAt }); }
                        if (!rec.refreshToken || (fresh && p.refresh !== true)) return reply();
                        return postToken(rec.tokenEndpoint, { grant_type: "refresh_token", refresh_token: rec.refreshToken,
                                                              client_id: rec.clientId, client_secret: rec.clientSecret }).then(function (body) {
                            current(expected);
                            keep(rec, body);
                            return storeMutation(function () { return env.keystore.put("key:" + p.keyId, rec); }, expected).then(reply);
                        });
                    });
                });
                return slot.token;
            }));
        },

        forget: function (p, caller) {
            var expected = generation;
            return wrap(owned(p, caller).then(function () {
                ready(); current(expected);
                var slot = keyState(p.keyId);
                if (slot.forgetting) return slot.forgetting;
                slot.forgetting = ordered(p.keyId, slot, function () {
                    current(expected);
                    // A rotation may have committed while disconnect waited.
                    return owned(p, caller).then(function (rec) {
                        current(expected);
                        function revokeOne(token, hint) {
                            return Promise.resolve(env.request({ method: "POST", url: rec.revocationEndpoint,
                                                                 headers: { "Content-Type": "application/x-www-form-urlencoded" },
                                                                 body: form({ token: token, token_type_hint: hint, client_id: rec.clientId, client_secret: rec.clientSecret }) }))
                                .catch(function (e) { log("token not revoked: " + e.message); });
                        }
                        var revoke = !rec.revocationEndpoint ? Promise.resolve()
                            : (rec.refreshToken ? revokeOne(rec.refreshToken, "refresh_token") : Promise.resolve()).then(function () {
                                return revokeOne(rec.accessToken, "access_token");
                            });
                        return revoke.then(function () {
                            return storeMutation(function () { return env.keystore.del("key:" + p.keyId); }, expected);
                        }).then(function () { return ok(); });
                    });
                });
                return slot.forgetting;
            }));
        },

        client: function (p, caller) {
            return wrap(Promise.resolve().then(function () {
                if (!p.name) throw Object.assign(new Error("name is required"), { errorCode: "BAD_PARAMS" });
                ready();
                var expected = generation;
                var owner = ownerOf(p, caller);
                var id = "client:" + owner + ":" + p.name;
                if (p.value === null) return storeMutation(function () { return env.keystore.del(id); }, expected).then(function () { return ok(); });
                if (p.value !== undefined) return storeMutation(function () { return env.keystore.put(id, p.value); }, expected).then(function () { return ok(); });
                return storeWrites.then(function () { current(expected); return env.keystore.get(id); }).then(function (v) {
                    current(expected);
                    return ok({ value: v === undefined ? null : v });
                });
            }));
        }
    };
}

module.exports = { createOAuthService: createOAuthService, METHODS: METHODS, SERVICE: "org.webosphoenix.service.oauth",
                   b64url: b64url, queryOf: queryOf };
