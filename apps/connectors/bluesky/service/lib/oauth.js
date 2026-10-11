// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// OAuth for the AT Protocol (https://atproto.com/specs/oauth), the way
// Bluesky signs in a client that holds no secret:
//
//   client id   the address of a client metadata document Phoenix hosts
//               (oauth/client-metadata.json in this package: a "native"
//               public client, token_endpoint_auth_method "none",
//               dpop_bound_access_tokens); no registration or approval with
//               Bluesky. Its address and redirect URI are the image's
//               setting, /etc/palm/bluesky/clients.json
//               ({"bluesky": {"clientId": "https://.../client-metadata.json",
//               "redirectUri": "org.webosphoenix:/oauth/bluesky"}})
//   discovery   the PDS's /.well-known/oauth-protected-resource names its
//               authorization server, whose
//               /.well-known/oauth-authorization-server gives the PAR,
//               authorization and token endpoints
//   PAR         the request (PKCE S256, state, scope, login_hint) is pushed
//               to the server first (RFC 9126); the browser is sent to the
//               authorization endpoint with client_id and request_uri only
//   DPoP        every token request and every call to the PDS carries a
//               proof signed with the session's own ES256 key (RFC 9449),
//               with the server's nonce (use_dpop_nonce: tried again with
//               the DPoP-Nonce it sent) and, at the PDS, the token's hash
//               (ath); tokens are "DPoP" tokens
//   tokens      the token answer's sub must be the account's DID and its
//               issuer the server the PDS named; refresh tokens are used
//               once (each refresh gives a new one, kept by the caller)
//
// The browser step needs the system's sign-in sheet to stop at the
// redirect and hand back its address: sheet(url, redirectUri) -> the
// address. org.webosphoenix.service.oauth has the sheet but not PAR and
// DPoP (its authorize does the plain code flow itself), so the connector
// does the protocol and asks for the sheet alone (connector.js).

"use strict";

var A = require("./atproto");

var SCOPE = "atproto transition:generic transition:chat.bsky";

function subtle() {
    if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto.subtle;
    return require("crypto").webcrypto.subtle;
}
function randomBytes(n) {
    var b = new Uint8Array(n);
    if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
    else require("crypto").webcrypto.getRandomValues(b);
    return b;
}
function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    var b = typeof btoa === "function" ? btoa(s) : Buffer.from(s, "latin1").toString("base64");
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function utf8(s) { return new TextEncoder().encode(s); }
function sha256(s) { return subtle().digest("SHA-256", typeof s === "string" ? utf8(s) : s).then(function (d) { return new Uint8Array(d); }); }
function form(o) {
    return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null && o[k] !== ""; })
        .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&");
}
function header(res, name) {
    var h = res.headers || {};
    var k = Object.keys(h).filter(function (x) { return x.toLowerCase() === name.toLowerCase(); })[0];
    return k ? String(h[k]) : "";
}

// ---- DPoP --------------------------------------------------------------------------------

/** A new ES256 key, as a private JWK (kept with the session). */
function newKey() {
    return subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]).then(function (k) {
        return subtle().exportKey("jwk", k.privateKey);
    });
}

function publicJwk(jwk) { return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }; }

/** A DPoP proof for one request (RFC 9449 4.2). */
function proof(jwk, htm, htu, nonce, accessToken, now) {
    var key = subtle().importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    var ath = accessToken ? sha256(accessToken).then(b64url) : Promise.resolve(null);
    return Promise.all([key, ath]).then(function (got) {
        var head = { typ: "dpop+jwt", alg: "ES256", jwk: publicJwk(jwk) };
        var body = { jti: b64url(randomBytes(16)), htm: htm, htu: String(htu).replace(/[?#].*$/, ""), iat: Math.floor((now || Date.now()) / 1000) };
        if (nonce) body.nonce = nonce;
        if (got[1]) body.ath = got[1];
        var input = b64url(utf8(JSON.stringify(head))) + "." + b64url(utf8(JSON.stringify(body)));
        // WebCrypto's ECDSA signature is r||s, as JWS wants it.
        return subtle().sign({ name: "ECDSA", hash: "SHA-256" }, got[0], utf8(input)).then(function (sig) {
            return input + "." + b64url(new Uint8Array(sig));
        });
    });
}

// ---- Discovery ----------------------------------------------------------------------------

function getJson(ctx, url) {
    return ctx.http.request({ method: "GET", url: url, headers: { Accept: "application/json" } }).then(function (res) {
        var b = A.jsonOf(res);
        if (res.status !== 200 || !b) throw A.fail("Could not read " + url + " (" + res.status + ")", "HOST_NOT_FOUND", res.status);
        return b;
    });
}

/** The PDS's authorization server and its metadata. */
function discover(ctx, pds) {
    return getJson(ctx, pds + "/.well-known/oauth-protected-resource").then(function (pr) {
        var as = (pr.authorization_servers || [])[0];
        if (!as) throw A.fail("The PDS names no authorization server", "UNSUPPORTED_CAPABILITY");
        ctx.http.allowHost(new URL(as).host);
        return getJson(ctx, as.replace(/\/+$/, "") + "/.well-known/oauth-authorization-server").then(function (m) {
            if (m.issuer !== as.replace(/\/+$/, "") && m.issuer !== as) throw A.fail("The authorization server's issuer is not " + as, "400_BAD_REQUEST");
            if (!m.pushed_authorization_request_endpoint || !m.token_endpoint || !m.authorization_endpoint)
                throw A.fail("The authorization server lacks PAR or its endpoints", "UNSUPPORTED_CAPABILITY");
            [m.pushed_authorization_request_endpoint, m.token_endpoint, m.authorization_endpoint].forEach(function (u) { ctx.http.allowHost(new URL(u).host); });
            return m;
        });
    });
}

// A token endpoint or PAR request with DPoP, once more with the server's nonce if it asks.
function dpopPost(ctx, url, body, jwk, nonce) {
    function attempt(n, again) {
        return proof(jwk, "POST", url, n, null, ctx.now()).then(function (p) {
            return ctx.http.request({ method: "POST", url: url, body: form(body),
                                      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", DPoP: p } });
        }).then(function (res) {
            var b = A.jsonOf(res) || {};
            var next = header(res, "DPoP-Nonce") || n;
            if (!again && res.status === 400 && b.error === "use_dpop_nonce" && next) return attempt(next, true);
            return { res: res, body: b, nonce: next };
        });
    }
    return attempt(nonce || "", false);
}

/** The whole sign-in: PAR, the sheet, the token exchange -> the session to keep. */
function signIn(ctx, o) {
    // o: {who: {did, handle, pds}, clientId, redirectUri, scope?, sheet(url, redirectUri) -> Promise<address>}
    var meta, jwk, verifier = b64url(randomBytes(32)), state = b64url(randomBytes(16));
    return discover(ctx, o.who.pds).then(function (m) {
        meta = m;
        return newKey();
    }).then(function (k) {
        jwk = k;
        return sha256(verifier);
    }).then(function (challenge) {
        return dpopPost(ctx, meta.pushed_authorization_request_endpoint, {
            client_id: o.clientId, response_type: "code", code_challenge: b64url(challenge), code_challenge_method: "S256",
            state: state, redirect_uri: o.redirectUri, scope: o.scope || SCOPE, login_hint: o.who.handle
        }, jwk, "");
    }).then(function (par) {
        if (par.res.status !== 201 && par.res.status !== 200 || !par.body.request_uri)
            throw A.fail("The authorization server refused the sign-in request: " + (par.body.error_description || par.body.error || par.res.status), "401_UNAUTHORIZED");
        var url = meta.authorization_endpoint + (meta.authorization_endpoint.indexOf("?") < 0 ? "?" : "&") +
            form({ client_id: o.clientId, request_uri: par.body.request_uri });
        return o.sheet(url, o.redirectUri).then(function (back) {
            if (!back) throw A.fail("The sign-in was closed", "CANCELED");
            var q = {};
            (String(back).replace(/#.*$/, "").split("?")[1] || "").split("&").forEach(function (kv) {
                var i = kv.indexOf("=");
                if (i > 0) q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
            });
            if (q.state !== state) throw A.fail("The answer is not of this sign-in (state)", "401_UNAUTHORIZED");
            if (q.error) throw A.fail(q.error_description || q.error, q.error === "access_denied" ? "ACCESS_DENIED" : "401_UNAUTHORIZED");
            if (q.iss && q.iss !== meta.issuer) throw A.fail("The answer is from another server (iss)", "401_UNAUTHORIZED");
            return dpopPost(ctx, meta.token_endpoint, { grant_type: "authorization_code", code: q.code, redirect_uri: o.redirectUri,
                                                       client_id: o.clientId, code_verifier: verifier }, jwk, par.nonce);
        });
    }).then(function (t) {
        return keep(t, o.who, meta, jwk, ctx.now());
    });
}

function keep(t, who, meta, jwk, now) {
    var b = t.body;
    if (t.res.status !== 200 || !b.access_token) throw A.fail("The token endpoint answered " + t.res.status + (b.error ? " (" + b.error + ")" : ""), "401_UNAUTHORIZED");
    if (String(b.token_type || "").toLowerCase() !== "dpop") throw A.fail("Not a DPoP token", "401_UNAUTHORIZED");
    if (b.sub !== who.did) throw A.fail("The token is not the account's (" + b.sub + ")", "401_UNAUTHORIZED");
    return { kind: "oauth", did: who.did, pds: who.pds, issuer: meta.issuer, tokenEndpoint: meta.token_endpoint,
             revocationEndpoint: meta.revocation_endpoint || "", accessToken: b.access_token, refreshToken: b.refresh_token || "",
             expiresAt: b.expires_in ? now + Number(b.expires_in) * 1000 : 0, scope: b.scope || "", jwk: jwk, asNonce: t.nonce || "", pdsNonce: "" };
}

function refresh(ctx, s, clientId) {
    return dpopPost(ctx, s.tokenEndpoint, { grant_type: "refresh_token", refresh_token: s.refreshToken, client_id: clientId }, s.jwk, s.asNonce)
        .then(function (t) {
            var n = keep(t, { did: s.did, pds: s.pds }, { issuer: s.issuer, token_endpoint: s.tokenEndpoint, revocation_endpoint: s.revocationEndpoint },
                         s.jwk, ctx.now());
            return n;
        });
}

/**
 * The PDS client of an OAuth session (store: {get(), set(session)}), its
 * token refreshed when it has expired or the PDS refuses it.
 */
function oauthClient(ctx, store, clientId) {
    var s = store.get();
    var auth = {
        header: function (method, url) {
            var expired = s.expiresAt && s.expiresAt - 30000 < ctx.now();
            return (expired ? auth.refresh() : Promise.resolve()).then(function () {
                return proof(s.jwk, method, url, s.pdsNonce, s.accessToken, ctx.now());
            }).then(function (p) { return { Authorization: "DPoP " + s.accessToken, DPoP: p }; });
        },
        // A new nonce from the PDS (401 use_dpop_nonce): only the nonce changes.
        retryOn: function (res) { return res.status === 401 && /use_dpop_nonce/.test(header(res, "WWW-Authenticate")); },
        refresh: function (res) {
            if (res && /use_dpop_nonce/.test(header(res, "WWW-Authenticate"))) {
                s.pdsNonce = header(res, "DPoP-Nonce") || s.pdsNonce;
                store.set(s);
                return Promise.resolve();
            }
            if (!s.refreshToken) return Promise.reject(A.fail("The sign-in has expired: sign in again", "401_UNAUTHORIZED", 401));
            return refresh(ctx, s, clientId).then(function (n) {
                n.pdsNonce = s.pdsNonce;
                s = n;
                store.set(s);
            }, function (e) {
                throw A.fail("The sign-in has expired: sign in again (" + e.message + ")", "401_UNAUTHORIZED", 401);
            });
        }
    };
    return A.client(ctx, s.pds, auth);
}

/** Revoke the refresh token (RFC 7009) when the account goes. */
function revoke(ctx, s, clientId) {
    if (!s || !s.revocationEndpoint || !s.refreshToken) return Promise.resolve();
    return dpopPost(ctx, s.revocationEndpoint, { token: s.refreshToken, client_id: clientId }, s.jwk, s.asNonce).catch(function () {});
}

module.exports = { SCOPE: SCOPE, discover: discover, signIn: signIn, oauthClient: oauthClient, refresh: refresh, revoke: revoke,
                   proof: proof, newKey: newKey, b64url: b64url, sha256: sha256 };
