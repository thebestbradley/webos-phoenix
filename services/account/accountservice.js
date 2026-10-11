// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.account: the device's side of the Phoenix
// Account (the "Pre Account" of docs/PLATFORM.md 6.2-6.5; the user-visible
// name is ACCOUNT_NAME below, OPEN-QUESTIONS Q40) and of the cloud
// services that go with it, and the one place the platform's servers are
// configured from (docs/PLATFORM-CLIENT.md; the contract is
// docs/platform-api/openapi.yaml).
//
// Everything here is inert until /etc/palm/phoenix/servers.json names an
// API host and an account issuer: getStatus then says "notSetUp" and every
// other method answers NOT_SET_UP. Nothing is needed to browse, install or
// update (APP-STORE.md 3.10); the account adds cloud backup, push relay
// channels, the token relay for providers that need a client secret, and
// the assistant's Phoenix provider.
//
// Signing in (OpenID Connect against the issuer, endpoints from its
// discovery document <issuer>/.well-known/openid-configuration):
//   "code"    the device authorization grant (RFC 8628), the default and
//             the only way on a device without the browser sheet (Q29):
//             the device shows a code and a QR code of
//             verification_uri_complete; the person approves on any phone or
//             computer; this service polls the token endpoint (interval,
//             slow_down adds 5 s, access_denied, expired_token) and keeps
//             the tokens in the key store
//   "browser" the authorization code flow with PKCE in the system browser
//             sheet, through org.webosphoenix.service.oauth (authorize,
//             token, forget) as the Synergy connectors sign in; the tokens
//             stay in that service's key store under its keyId
// Then the device registers itself (POST /v1/devices) and reads the
// account (GET /v1/me) and its entitlements (GET /v1/me/entitlements,
// signed: the X-Phoenix-Signature header, Ed25519 over the body's bytes,
// by servers.json's "account.key"; kept, and trusted offline until
// validUntil + graceDays).
//
// Methods (callers: Settings, First Use, the backup service, the
// assistant, connectors; the last column says who may call):
//   getServers {}                 -> {servers (resolved), override, devMode}      any
//   setServers {servers | null} | {url}   Developer Mode only: the override laid over
//                                 servers.json (null: back to the image's; url: a
//                                 platform's own <api>/v1/servers.json)           Settings
//   getStatus {subscribe?}        -> {state: "notSetUp" | "signedOut" |
//                                 "signingIn" | "signedIn", account, device,
//                                 signIn: {method, userCode, verificationUri,
//                                 verificationUriComplete, expiresAt} | null,
//                                 entitlements, error, accountName, issuer}       any
//   signIn {method?: "code" | "browser"} -> status (the code to show)           Settings, First Use
//   cancelSignIn {}                                                              Settings, First Use
//   signOut {}                    unregisters the device (DELETE
//                                 /v1/devices/{id}), revokes the tokens          Settings
//   refresh {}                    reads the account and entitlements again       any
//   entitlements {}               -> {entitlements} (cached, verified)          any
//   devices {}                    -> {items} (GET /v1/me/devices)               Settings
//   backupCredentials {}          -> {url, username, password} for this device
//                                 (POST /v1/backup/credentials, kept)           the backup service
//   backupSummary {}              -> {usedBytes, quotaBytes, devices}            the backup service, First Use
//   pushEndpoint {app}            -> {server, endpoint}: a UnifiedPush topic on
//                                 the push server for app (kept per app)         the push service, connectors
//   pushRegister {provider, endpoint, p256dh, auth, clientState?}
//                                 -> {channelId, url, expiresAt}                 connectors
//   pushRenew {channelId}, pushDrop {channelId}                                  connectors
//   tokenRelay {provider, step: "authorizeUrl" | "redeem" | "refresh", ...}
//                                 the OAuth broker (PLATFORM.md 6.5.4, Q49)      the OAuth service, connectors
//   assistantProvider {}          -> {baseUrl, apiKey (the access token),
//                                 models}: an OpenAI-compatible provider         the assistant
//
// Errors: NOT_SET_UP, SIGNED_OUT, BUSY, ACCESS_DENIED, EXPIRED,
// CONNECTION_FAILED, BAD_SERVER, BAD_SIGNATURE, UNAUTHORIZED, FORBIDDEN,
// RATE_LIMITED (retryAfter), QUOTA, NEEDS_DEVMODE, NOT_ALLOWED, BAD_PARAMS,
// and the server's own codes (PLATFORM.md 5).

"use strict";

var platform = require("@phoenix/platform");

var SERVICE = "org.webosphoenix.service.account";
var ACCOUNT_NAME = "Phoenix Account";   // Q40: one string to change
var METHODS = ["getServers", "setServers", "getStatus", "signIn", "cancelSignIn", "signOut", "refresh", "entitlements", "devices",
               "backupCredentials", "backupSummary", "pushEndpoint", "pushRegister", "pushRenew", "pushDrop", "tokenRelay",
               "assistantProvider"];
var DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
var TOKENS = "account:tokens";
var BACKUP = "account:backup";

// Who may call what (on a device luna-service2's permissions say which
// apps reach the service at all; this is the finer cut, as
// org.webosphoenix.service.oauth checks its keys' owners).
var SETTINGS = ["org.webosphoenix.settings", "org.webosphoenix.firstuse", "com.palm.app.firstuse"];
var CALLERS = {
    setServers: SETTINGS, signIn: SETTINGS, cancelSignIn: SETTINGS, signOut: SETTINGS, devices: SETTINGS,
    backupCredentials: ["org.webosphoenix.service.backup"],
    backupSummary: ["org.webosphoenix.service.backup"].concat(SETTINGS),
    assistantProvider: ["org.webosphoenix.assistant"]
};

function err(code, text, extra) {
    var e = new Error(text);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
}
function fail(e) {
    var r = { returnValue: false, errorCode: e && typeof e.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(e.code) ? e.code : "UNKNOWN_ERROR",
              errorText: (e && e.message) || String(e) };
    if (e && e.retryAfter) r.retryAfter = Math.ceil(e.retryAfter / 1000);
    return r;
}
function form(o) {
    return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null; })
        .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&");
}

// deps:
//   request({method, url, headers, body}) -> Promise<{status, headers, body (text)}>
//   requestBytes (optional) -> Promise<{status, headers, bytes}>: the
//       entitlements' signed body; without it the text is encoded again
//   luna.call(uri, params) -> Promise<reply> (Developer Mode, the OAuth
//       service, notifications)
//   keystore {get(id), put(id, value), del(id)} -> Promise: tokens and the
//       backup password, never in state
//   state.load() / state.save(obj): the account's profile, the device id,
//       the entitlements, the discovery document
//   servers() -> Promise<resolved servers.json> (@phoenix/platform load())
//   override {read() -> object | null, write(object | null)}
//   crypto {sha256, sha512 -> Promise<Uint8Array>, randomBytes(n) -> Uint8Array,
//           deviceKey() -> Promise<base64 Ed25519 public key> (made once, the
//           private half kept on the device)}
//   device() -> Promise<{name, model, compatible, osVersion, build}>
//   timers {set(fn, ms) -> handle, clear(handle)} (optional)
//   now(), log() (optional)
function createAccountService(deps) {
    var log = deps.log || function () {};
    var now = deps.now || function () { return new Date(); };
    var timers = deps.timers || { set: function (fn, ms) { return setTimeout(fn, ms); }, clear: function (h) { clearTimeout(h); } };
    var watchers = [];
    var pending = null;       // the sign-in being made: {method, deviceCode, interval, timer, ...}
    var lastError = null;
    var sv = null;            // servers.json, resolved

    function servers() {
        return Promise.resolve(deps.servers()).then(function (r) { sv = r; return r; });
    }
    function setUp() {
        return servers().then(function (r) {
            if (!r || !r.account || !r.api) throw err("NOT_SET_UP", "No " + ACCOUNT_NAME + " server is set up on this device");
            return r;
        });
    }
    function load() { return deps.state.load() || {}; }
    function save(s) { deps.state.save(s); }
    function http(req) {
        return Promise.resolve(deps.request(req)).then(null, function (e) {
            throw err("CONNECTION_FAILED", "Cannot reach " + new URL(req.url).host + " (" + (e && e.message) + ")");
        });
    }
    function json(res, what) { return platform.http.json(res, what); }

    // ---- Status ------------------------------------------------------------------------

    function status() {
        return servers().then(function (r) {
            var s = load();
            var configured = !!(r && r.account && r.api);
            var state = !configured ? "notSetUp" : pending ? "signingIn" : s.signedIn ? "signedIn" : "signedOut";
            return {
                returnValue: true, state: state, accountName: ACCOUNT_NAME,
                issuer: configured ? r.account.issuer : null,
                account: state === "signedIn" ? s.account || null : null,
                device: state === "signedIn" && s.deviceId ? { id: s.deviceId } : null,
                signIn: pending ? { method: pending.method, userCode: pending.userCode || null, verificationUri: pending.verificationUri || null,
                                    verificationUriComplete: pending.verificationUriComplete || null, expiresAt: pending.expiresAt || null } : null,
                entitlements: state === "signedIn" ? entitlementsView(s) : null,
                services: configured ? { backup: !!r.backup, push: !!(r.push && r.push.server), assistant: !!r.assistant } : null,
                error: lastError
            };
        });
    }
    function changed() {
        return status().then(function (st) {
            watchers.forEach(function (w) { w(st); });
            return st;
        }, function (e) { log("status: " + e.message); });
    }

    // ---- Discovery and tokens -------------------------------------------------------------

    function discovery(r) {
        var s = load();
        if (s.discovery && s.discovery.issuer === r.account.issuer && s.discovery.fetched &&
            now().getTime() - Date.parse(s.discovery.fetched) < 24 * 3600 * 1000) return Promise.resolve(s.discovery.doc);
        var url = r.account.issuer + "/.well-known/openid-configuration";
        return http({ method: "GET", url: url, headers: { Accept: "application/json" } }).then(function (res) {
            if (res.status !== 200) throw platform.http.apiError(res, "The account server");
            var d = json(res, "The account server");
            // OpenID Connect Discovery 1.0, 4.3: the issuer must be the one asked.
            if (!d || d.issuer !== r.account.issuer || typeof d.token_endpoint !== "string")
                throw err("BAD_SERVER", "The account server's discovery document is not for " + r.account.issuer);
            var s2 = load();
            s2.discovery = { issuer: r.account.issuer, fetched: now().toISOString(), doc: d };
            save(s2);
            return d;
        });
    }

    function tokens() { return Promise.resolve(deps.keystore.get(TOKENS)).then(function (t) { return t || null; }); }

    function keep(body, via) {
        if (!body || typeof body.access_token !== "string") throw err("BAD_SERVER", "The account server sent no access token");
        var t = { via: via || "code", accessToken: body.access_token, refreshToken: body.refresh_token || null,
                  tokenType: body.token_type || "Bearer", scope: body.scope || "",
                  expiresAt: body.expires_in ? now().getTime() + body.expires_in * 1000 : null };
        return Promise.resolve(deps.keystore.put(TOKENS, t)).then(function () { return t; });
    }

    // An access token for the API: refreshed when it is about to expire
    // (refresh tokens rotate on use, PLATFORM.md 5).
    function accessToken(force) {
        return tokens().then(function (t) {
            if (!t) throw err("SIGNED_OUT", "Sign in to your " + ACCOUNT_NAME + " first");
            if (t.via === "browser") {
                return deps.luna.call("luna://org.webosphoenix.service.oauth/token", { keyId: t.keyId }).then(function (r) {
                    if (!r || !r.returnValue) throw err(r && r.errorCode === "NOT_FOUND" ? "SIGNED_OUT" : "UNAUTHORIZED",
                                                        (r && r.errorText) || "The sign-in has ended");
                    return r.accessToken;
                });
            }
            if (!force && (!t.expiresAt || t.expiresAt - 60000 > now().getTime())) return t.accessToken;
            if (!t.refreshToken) throw err("SIGNED_OUT", "The sign-in has ended; sign in again");
            return setUp().then(discovery).then(function (d) {
                return http({ method: "POST", url: d.token_endpoint, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                              body: form({ grant_type: "refresh_token", refresh_token: t.refreshToken, client_id: sv.account.clientId }) });
            }).then(function (res) {
                if (res.status === 400 || res.status === 401) {
                    var b = null;
                    try { b = JSON.parse(res.body); } catch (e) { b = null; }
                    if (b && (b.error === "invalid_grant" || b.error === "invalid_token")) return endSession("Your " + ACCOUNT_NAME + " sign-in ended; sign in again");
                }
                if (res.status !== 200) throw platform.http.apiError(res, "The account server");
                return keep(json(res), "code").then(function (t2) { return t2.accessToken; });
            });
        });
    }
    // The server no longer takes this device's tokens (signed out on the
    // web, the device removed): forget them here too.
    function endSession(text) {
        return clearLocal().then(function () {
            lastError = { errorCode: "SIGNED_OUT", errorText: text };
            changed();
            throw err("SIGNED_OUT", text);
        });
    }
    function clearLocal() {
        return Promise.all([deps.keystore.del(TOKENS), deps.keystore.del(BACKUP)]).then(function () {
            var s = load();
            s.signedIn = false;
            s.account = null;
            s.deviceId = null;
            s.entitlements = null;
            s.push = null;
            save(s);
        });
    }

    // An API call with the account's token: one retry with a fresh token on
    // 401; the server's errors as errorCode (PLATFORM.md 5).
    function api(method, path, body, opts) {
        return setUp().then(function (r) {
            var url = r.api + path.replace(/^\//, "");
            var once = function (force) {
                return accessToken(force).then(function (tok) {
                    var headers = { Authorization: "Bearer " + tok, Accept: "application/json" };
                    if (body !== undefined) headers["Content-Type"] = "application/json";
                    if (opts && opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
                    var req = { method: method, url: url, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) };
                    return opts && opts.bytes && deps.requestBytes
                        ? Promise.resolve(deps.requestBytes(req)).then(null, function (e) { throw err("CONNECTION_FAILED", "Cannot reach the " + ACCOUNT_NAME + " server (" + e.message + ")"); })
                        : http(req);
                });
            };
            return once(false).then(function (res) {
                return res.status === 401 ? once(true) : res;
            }).then(function (res) {
                if (res.status === 401) return endSession("Your " + ACCOUNT_NAME + " sign-in ended; sign in again");
                if (res.status < 200 || res.status >= 300) {
                    if (res.bytes && res.body === undefined) res.body = platform.b64.fromUtf8(res.bytes);
                    throw platform.http.apiError(res, "The " + ACCOUNT_NAME + " server", now().getTime());
                }
                return res;
            });
        });
    }
    function apiJson(method, path, body, opts) {
        return api(method, path, body, opts).then(function (res) { return res.status === 204 ? {} : json(res); });
    }

    // ---- Sign in --------------------------------------------------------------------------

    function signIn(p) {
        var method = p.method === "browser" ? "browser" : "code";
        if (pending) return Promise.reject(err("BUSY", "A sign-in is in progress"));
        return setUp().then(function (r) {
            return discovery(r).then(function (d) {
                lastError = null;
                return method === "code" ? deviceCode(r, d) : browser(r, d);
            });
        });
    }

    function deviceCode(r, d) {
        var endpoint = d.device_authorization_endpoint;
        if (typeof endpoint !== "string") throw err("BAD_SERVER", "The account server does not offer sign-in with a code");
        return http({ method: "POST", url: endpoint, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                      body: form({ client_id: r.account.clientId, scope: r.account.scope }) }).then(function (res) {
            if (res.status !== 200) throw platform.http.apiError(res, "The account server");
            var b = json(res);
            if (!b || typeof b.device_code !== "string" || typeof b.user_code !== "string" || typeof b.verification_uri !== "string")
                throw err("BAD_SERVER", "The account server's device code reply is incomplete");
            pending = {
                method: "code", deviceCode: b.device_code, userCode: b.user_code, verificationUri: b.verification_uri,
                verificationUriComplete: b.verification_uri_complete || null,
                expiresAt: new Date(now().getTime() + (b.expires_in || 600) * 1000).toISOString(),
                // RFC 8628 3.2: 5 seconds when the server says nothing.
                interval: Math.max(0, typeof b.interval === "number" ? b.interval : 5), tokenEndpoint: d.token_endpoint, timer: null
            };
            poll(r);
            return changed();
        });
    }

    function poll(r) {
        if (!pending || pending.method !== "code") return;
        var mine = pending;
        mine.timer = timers.set(function () {
            if (pending !== mine) return;
            if (Date.parse(mine.expiresAt) <= now().getTime()) return failSignIn("EXPIRED", "The code expired; sign in again");
            http({ method: "POST", url: mine.tokenEndpoint, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                   body: form({ grant_type: DEVICE_GRANT, device_code: mine.deviceCode, client_id: r.account.clientId }) }).then(function (res) {
                if (pending !== mine) return null;
                var b = null;
                try { b = JSON.parse(res.body); } catch (e) { b = null; }
                if (res.status === 200) return keep(b, "code").then(function () { return finishSignIn(); });
                var code = b && b.error;
                if (code === "authorization_pending") return poll(r);
                if (code === "slow_down") { mine.interval += 5; return poll(r); }   // RFC 8628 3.5
                if (code === "access_denied") return failSignIn("ACCESS_DENIED", "The sign-in was turned down");
                if (code === "expired_token") return failSignIn("EXPIRED", "The code expired; sign in again");
                if (res.status === 429 || res.status >= 500) { mine.interval += 5; return poll(r); }
                return failSignIn("BAD_SERVER", (b && (b.error_description || b.error)) || "The account server answered " + res.status);
            }, function (e) {
                // Offline for a moment: keep asking until the code expires.
                log("poll: " + e.message);
                if (pending === mine) { mine.interval = Math.min(60, mine.interval + 5); poll(r); }
            });
        }, mine.interval * 1000);
    }

    function failSignIn(code, text) {
        if (pending && pending.timer) timers.clear(pending.timer);
        pending = null;
        lastError = { errorCode: code, errorText: text };
        return changed();
    }

    function browser(r, d) {
        if (typeof d.authorization_endpoint !== "string") throw err("BAD_SERVER", "The account server does not offer browser sign-in");
        pending = { method: "browser" };
        changed();
        return deps.luna.call("luna://org.webosphoenix.service.oauth/authorize", {
            authorizationEndpoint: d.authorization_endpoint, tokenEndpoint: d.token_endpoint, clientId: r.account.clientId,
            scope: r.account.scope, revocationEndpoint: d.revocation_endpoint || undefined
        }).then(function (res) {
            if (!res || !res.returnValue) {
                pending = null;
                var code = res && res.errorCode === "CANCELED" ? "CANCELED" : res && res.errorCode === "ACCESS_DENIED" ? "ACCESS_DENIED"
                    : (res && res.errorCode) || "UNKNOWN_ERROR";
                lastError = { errorCode: code, errorText: (res && res.errorText) || "The sign-in did not finish" };
                changed();
                throw err(code, lastError.errorText);
            }
            return Promise.resolve(deps.keystore.put(TOKENS, { via: "browser", keyId: res.keyId, scope: res.scope || "" })).then(finishSignIn);
        });
    }

    // Signed in: this device registered, the account and its entitlements read.
    function finishSignIn() {
        if (pending && pending.timer) timers.clear(pending.timer);
        return Promise.all([apiJson("GET", "v1/me"), Promise.resolve(deps.device()), Promise.resolve(deps.crypto.deviceKey())]).then(function (got) {
            var me = got[0], dev = got[1] || {};
            var s = load();
            var reg = s.deviceId && s.accountId === me.id
                ? Promise.resolve({ id: s.deviceId })
                : apiJson("POST", "v1/devices", { publicKey: got[2], name: dev.name || "Phoenix device", model: dev.model || "",
                                                   compatible: dev.compatible || "", osVersion: dev.osVersion || "", build: dev.build || 0 },
                          { idempotencyKey: platform.b64.hex(deps.crypto.randomBytes(16)) });
            return reg.then(function (d) {
                var s2 = load();
                s2.account = profile(me);
                s2.accountId = me.id;
                s2.deviceId = d.id;
                save(s2);
                return readEntitlements().then(null, function (e) { log("entitlements: " + e.message); });
            }).then(function () {
                // Signed in once all of it is there.
                var s3 = load();
                s3.signedIn = true;
                save(s3);
                pending = null;
                lastError = null;
            });
        }).then(function () {
            deps.luna.call("luna://com.webos.notification/createToast", {
                message: "Signed in to your " + ACCOUNT_NAME + " as " + ((load().account || {}).email || ""),
                onclick: { appId: "org.webosphoenix.settings", params: { page: "account" } }
            }).then(null, function () {});
            return changed();
        }, function (e) {
            pending = null;
            lastError = { errorCode: e.code || "UNKNOWN_ERROR", errorText: e.message };
            return clearLocal().then(changed).then(function () { throw e; });
        });
    }
    function profile(me) {
        return { id: me.id, name: me.name || "", email: me.email || "", emailVerified: !!me.emailVerified, avatar: me.avatar || null,
                 locale: me.locale || "", plan: me.plan || "free", deleting: me.deleting || null };
    }

    function signOut() {
        return status().then(function (st) {
            if (st.state === "notSetUp") throw err("NOT_SET_UP", "No " + ACCOUNT_NAME + " server is set up on this device");
            var s = load();
            var steps = s.deviceId
                ? apiJson("DELETE", "v1/devices/" + encodeURIComponent(s.deviceId)).then(null, function (e) { log("unregister: " + e.message); })
                : Promise.resolve();
            return steps.then(tokens).then(function (t) {
                if (!t) return null;
                if (t.via === "browser") return deps.luna.call("luna://org.webosphoenix.service.oauth/forget", { keyId: t.keyId }).then(null, function () {});
                // RFC 7009: the refresh token, so the pair is gone on the server.
                return setUp().then(discovery).then(function (d) {
                    if (!d.revocation_endpoint || !t.refreshToken) return null;
                    return http({ method: "POST", url: d.revocation_endpoint, headers: { "Content-Type": "application/x-www-form-urlencoded" },
                                  body: form({ token: t.refreshToken, token_type_hint: "refresh_token", client_id: sv.account.clientId }) });
                }).then(null, function (e) { log("revoke: " + e.message); });
            }).then(clearLocal).then(function () { lastError = null; return changed(); });
        });
    }

    // ---- Entitlements ----------------------------------------------------------------------

    function entitlementsView(s) {
        var e = s.entitlements;
        if (!e || !e.doc) return null;
        var until = Date.parse(e.doc.validUntil || "") || 0;
        var grace = (e.doc.graceDays | 0) * 86400000;
        var t = now().getTime();
        return { plan: e.doc.plan || "free", features: e.doc.features || {}, validUntil: e.doc.validUntil || null,
                 graceDays: e.doc.graceDays | 0, issued: e.doc.issued || null, verified: !!e.verified, fetched: e.fetched,
                 current: !until || t <= until + grace };
    }
    // The server's key for entitlements: servers.json "account.key" (pinned
    // in the image), else the API's /v1/key.json read over HTTPS.
    function entitlementsKey(r) {
        if (r.account.key) return Promise.resolve(r.account.key);
        return http({ method: "GET", url: r.api + "v1/key.json", headers: { Accept: "application/json" } }).then(function (res) {
            if (res.status !== 200) throw platform.http.apiError(res, "The account server");
            var k = json(res);
            return k && typeof k.key === "string" ? k.key : null;
        });
    }
    function readEntitlements() {
        return setUp().then(function (r) {
            return Promise.all([api("GET", "v1/me/entitlements", undefined, { bytes: true }), entitlementsKey(r)]).then(function (got) {
                var res = got[0];
                var bytes = res.bytes || platform.b64.utf8(res.body || "");
                var sig = platform.http.header(res, "X-Phoenix-Signature");
                if (!sig || !got[1]) throw err("BAD_SIGNATURE", "The entitlements are not signed");
                return platform.signed.verifyDetached(bytes, sig, got[1], deps.crypto.sha512).then(function (ok) {
                    if (!ok) throw err("BAD_SIGNATURE", "The entitlements' signature does not match the server's key");
                    var doc;
                    try { doc = JSON.parse(platform.b64.fromUtf8(bytes)); } catch (e) { throw err("BAD_SERVER", "The entitlements are not JSON"); }
                    var s = load();
                    s.entitlements = { doc: doc, verified: true, fetched: now().toISOString() };
                    save(s);
                    return entitlementsView(s);
                });
            });
        });
    }
    function entitlements() {
        return readEntitlements().then(null, function (e) {
            // Offline or the server away: the kept copy, while it is current.
            var v = entitlementsView(load());
            if (v && (e.code === "CONNECTION_FAILED" || e.code === "SERVER_ERROR" || e.code === "RATE_LIMITED")) {
                v.offline = true;
                return v;
            }
            throw e;
        }).then(function (v) { return { returnValue: true, entitlements: v }; });
    }
    function hasFeature(name) {
        var v = entitlementsView(load());
        return !!(v && v.current && v.features && v.features[name]);
    }

    // ---- Cloud services ------------------------------------------------------------------

    function backupCredentials() {
        return setUp().then(function (r) {
            if (!r.backup) throw err("NOT_SET_UP", "Phoenix Cloud backup is not set up on this device");
            return Promise.resolve(deps.keystore.get(BACKUP)).then(function (kept) {
                if (kept && kept.url && kept.password) return kept;
                return apiJson("POST", "v1/backup/credentials", {}, { idempotencyKey: platform.b64.hex(deps.crypto.randomBytes(16)) }).then(function (c) {
                    if (!c || typeof c.url !== "string" || typeof c.username !== "string" || typeof c.password !== "string")
                        throw err("BAD_SERVER", "The backup credentials are incomplete");
                    var rec = { url: c.url, username: c.username, password: c.password };
                    return Promise.resolve(deps.keystore.put(BACKUP, rec)).then(function () { return rec; });
                });
            });
        }).then(function (c) { return { returnValue: true, url: c.url, username: c.username, password: c.password }; });
    }

    function pushEndpoint(p) {
        if (!p || typeof p.app !== "string" || !p.app) return Promise.reject(err("BAD_PARAMS", "app: the app or connector the endpoint is for"));
        return setUp().then(function (r) {
            if (!r.push || !r.push.server) throw err("NOT_SET_UP", "No push server is set up on this device");
            var s = load();
            s.pushTopics = s.pushTopics || {};
            if (!s.pushTopics[p.app] || s.pushTopics[p.app].server !== r.push.server) {
                // UnifiedPush on ntfy: a topic with a long random name is the
                // endpoint (anonymous access, PLATFORM.md 6.5.3); "?up=1"
                // marks it as UnifiedPush's.
                var topic = "up" + platform.b64.hex(deps.crypto.randomBytes(16));
                s.pushTopics[p.app] = { server: r.push.server, topic: topic };
                save(s);
            }
            var t = s.pushTopics[p.app];
            return { returnValue: true, server: t.server, topic: t.topic, endpoint: t.server + t.topic + "?up=1" };
        });
    }

    function pushRegister(p) {
        p = p || {};
        if (["graph", "google-calendar", "gmail"].indexOf(p.provider) < 0) return Promise.reject(err("BAD_PARAMS", "provider: graph, google-calendar or gmail"));
        if (typeof p.endpoint !== "string" || !/^https:\/\//.test(p.endpoint) && !/^http:\/\/(127\.|localhost)/.test(p.endpoint))
            return Promise.reject(err("BAD_PARAMS", "endpoint: the UnifiedPush endpoint (https)"));
        if (typeof p.p256dh !== "string" || typeof p.auth !== "string") return Promise.reject(err("BAD_PARAMS", "p256dh and auth: the Web Push keys (RFC 8291)"));
        return setUp().then(function () {
            return apiJson("POST", "v1/push/channels", { provider: p.provider, endpoint: p.endpoint, p256dh: p.p256dh, auth: p.auth,
                                                         clientState: p.clientState || undefined },
                           { idempotencyKey: platform.b64.hex(deps.crypto.randomBytes(16)) });
        }).then(function (c) {
            if (!c || typeof c.channelId !== "string" || typeof c.url !== "string") throw err("BAD_SERVER", "The relay's channel reply is incomplete");
            return { returnValue: true, channelId: c.channelId, url: c.url, expiresAt: c.expiresAt || null };
        });
    }
    function channelId(p) {
        if (!p || typeof p.channelId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(p.channelId)) throw err("BAD_PARAMS", "channelId");
        return encodeURIComponent(p.channelId);
    }

    // The OAuth broker (PLATFORM.md 6.5.4): for providers whose token
    // exchange needs a client secret. The PKCE pair stays between the device
    // and the broker; the broker keeps the tokens two minutes under a handle.
    function tokenRelay(p) {
        p = p || {};
        if (typeof p.provider !== "string" || !/^[a-z0-9-]{1,40}$/.test(p.provider)) return Promise.reject(err("BAD_PARAMS", "provider"));
        return setUp().then(function (r) {
            var base = "v1/oauth-broker/" + p.provider + "/";
            if (p.step === "authorizeUrl") {
                if (!p.codeChallenge || !p.state || !p.redirectUri) throw err("BAD_PARAMS", "codeChallenge, state and redirectUri");
                return { returnValue: true, url: r.api + base + "authorize?" + form({ code_challenge: p.codeChallenge, code_challenge_method: "S256",
                                                                                      state: p.state, redirect_uri: p.redirectUri, scope: p.scope }) };
            }
            if (p.step === "redeem") {
                if (!p.handle || !p.codeVerifier) throw err("BAD_PARAMS", "handle and codeVerifier");
                return apiJson("POST", base + "redeem", { handle: p.handle, code_verifier: p.codeVerifier }).then(relayTokens);
            }
            if (p.step === "refresh") {
                if (!p.refreshToken) throw err("BAD_PARAMS", "refreshToken");
                return apiJson("POST", base + "refresh", { refresh_token: p.refreshToken }).then(relayTokens);
            }
            throw err("BAD_PARAMS", "step: authorizeUrl, redeem or refresh");
        });
    }
    function relayTokens(b) {
        if (!b || typeof b.access_token !== "string") throw err("BAD_SERVER", "The broker sent no access token");
        return { returnValue: true, accessToken: b.access_token, refreshToken: b.refresh_token || null, tokenType: b.token_type || "Bearer",
                 expiresIn: b.expires_in || null, scope: b.scope || "" };
    }

    // The assistant's "Phoenix" provider: the OpenAI-compatible proxy with
    // the account's token in place of a pasted key (PLATFORM.md 6.5.5).
    function assistantProvider() {
        return setUp().then(function (r) {
            if (!r.assistant) throw err("NOT_SET_UP", "The Phoenix assistant service is not set up on this device");
            return accessToken(false).then(function (tok) {
                return { returnValue: true, baseUrl: r.assistant.url, apiKey: tok, entitled: hasFeature("assistant") };
            });
        });
    }

    // ---- Developer Mode's override ------------------------------------------------------------

    function devMode() {
        return deps.luna.call("luna://com.webos.service.devmode/getDevMode", {}).then(function (r) {
            return !!(r && r.status === "enabled");
        }, function () { return false; });
    }
    function getServers() {
        return Promise.all([servers(), devMode()]).then(function (got) {
            return { returnValue: true, servers: platform.servers.summary(got[0]), override: deps.override.read() || null, devMode: got[1] };
        });
    }
    function setServers(p) {
        return devMode().then(function (on) {
            if (!on) throw err("NEEDS_DEVMODE", "Turn on Developer Mode to point this device at other servers");
            // {url}: a platform's own servers.json (GET <api>/v1/servers.json,
            // which a staging server publishes), read and checked here.
            var fromUrl = p && typeof p.url === "string" && p.url ? http({ method: "GET", url: p.url, headers: { Accept: "application/json" } }).then(function (res) {
                if (res.status !== 200) throw platform.http.apiError(res, "That server");
                return platform.servers.parse(res.body);
            }) : Promise.resolve(p ? p.servers : undefined);
            return fromUrl;
        }).then(function (o) {
            if (o === undefined) throw err("BAD_PARAMS", "servers: the override, or null; or url: a servers.json address");
            if (o !== null) platform.servers.checkOverride(o);
            deps.override.write(o);
            // Another server: this device's sign-in belongs to the old one.
            return clearLocal().then(function () {
                var s = load();
                s.discovery = null;
                save(s);
                return getServers();
            });
        }).then(function (r) { changed(); return r; });
    }

    // ---- The service ---------------------------------------------------------------------------

    function guard(name, fn) {
        return function (p, caller) {
            var allowed = CALLERS[name];
            if (allowed && caller && allowed.indexOf(caller) < 0)
                return Promise.resolve(fail(err("NOT_ALLOWED", name + " is not for " + caller)));
            return Promise.resolve().then(function () { return fn(p || {}, caller); }).then(null, fail);
        };
    }

    var methods = {
        getServers: guard("getServers", getServers),
        setServers: guard("setServers", setServers),
        getStatus: guard("getStatus", status),
        signIn: guard("signIn", signIn),
        cancelSignIn: guard("cancelSignIn", function () {
            if (pending && pending.timer) timers.clear(pending.timer);
            pending = null;
            return changed();
        }),
        signOut: guard("signOut", signOut),
        refresh: guard("refresh", function () {
            return apiJson("GET", "v1/me").then(function (me) {
                var s = load();
                s.account = profile(me);
                save(s);
                return readEntitlements().then(null, function (e) { log("entitlements: " + e.message); });
            }).then(changed);
        }),
        entitlements: guard("entitlements", entitlements),
        devices: guard("devices", function () {
            return apiJson("GET", "v1/me/devices").then(function (b) {
                var mine = load().deviceId;
                return { returnValue: true, items: (b.items || []).map(function (d) { return Object.assign({}, d, { current: d.id === mine }); }) };
            });
        }),
        backupCredentials: guard("backupCredentials", backupCredentials),
        backupSummary: guard("backupSummary", function () {
            return apiJson("GET", "v1/backup/summary").then(function (b) { return Object.assign({ returnValue: true }, b); });
        }),
        pushEndpoint: guard("pushEndpoint", pushEndpoint),
        pushRegister: guard("pushRegister", pushRegister),
        pushRenew: guard("pushRenew", function (p) {
            return apiJson("POST", "v1/push/channels/" + channelId(p) + "/renew", {}).then(function (b) {
                return { returnValue: true, channelId: p.channelId, expiresAt: b.expiresAt || null };
            });
        }),
        pushDrop: guard("pushDrop", function (p) {
            return apiJson("DELETE", "v1/push/channels/" + channelId(p)).then(function () { return { returnValue: true }; });
        }),
        tokenRelay: guard("tokenRelay", tokenRelay),
        assistantProvider: guard("assistantProvider", assistantProvider),
        // onChange(status) after every change -> stop() (getStatus {subscribe})
        watch: function (onChange) {
            watchers.push(onChange);
            return function () { watchers = watchers.filter(function (w) { return w !== onChange; }); };
        }
    };
    return methods;
}

module.exports = { SERVICE: SERVICE, METHODS: METHODS, ACCOUNT_NAME: ACCOUNT_NAME, createAccountService: createAccountService };
