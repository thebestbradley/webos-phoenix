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
    var sessionGeneration = 0;
    var tokenWrites = Promise.resolve();
    var refreshing = null;
    var signingOut = null;
    var backupFlight = null;

    function currentSession(generation) {
        if (generation !== sessionGeneration) throw err("SIGNED_OUT", "The account session changed");
    }
    // Key-store writes may be asynchronous. A clear or a newer sign-in must
    // run after an already-started write, and stale refreshes may not commit.
    function tokenMutation(task) {
        var result = tokenWrites.then(task);
        tokenWrites = result.then(function () {}, function () {});
        return result;
    }
    function storeTokens(value, generation) {
        if (generation === undefined) generation = ++sessionGeneration;
        return tokenMutation(function () {
            currentSession(generation);
            return Promise.resolve(deps.keystore.put(TOKENS, value)).then(function () {
                currentSession(generation);
                return value;
            });
        });
    }

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

    function tokens() { return tokenWrites.then(function () { return deps.keystore.get(TOKENS); }).then(function (t) { return t || null; }); }

    function keep(body, via, generation) {
        if (!body || typeof body.access_token !== "string") throw err("BAD_SERVER", "The account server sent no access token");
        var t = { via: via || "code", accessToken: body.access_token, refreshToken: body.refresh_token || null,
                  tokenType: body.token_type || "Bearer", scope: body.scope || "",
                  expiresAt: body.expires_in ? now().getTime() + body.expires_in * 1000 : null };
        return storeTokens(t, generation);
    }

    // An access token for the API: refreshed when it is about to expire
    // (refresh tokens rotate on use, PLATFORM.md 5).
    function accessToken(force, rejectedToken) {
        var generation = sessionGeneration;
        return tokens().then(function (t) {
            currentSession(generation);
            if (!t) throw err("SIGNED_OUT", "Sign in to your " + ACCOUNT_NAME + " first");
            if (t.via === "browser") {
                var options = { keyId: t.keyId };
                if (force) options.refresh = true;
                return deps.luna.call("luna://org.webosphoenix.service.oauth/token", options).then(function (r) {
                    if (!r || !r.returnValue) throw err(r && r.errorCode === "NOT_FOUND" ? "SIGNED_OUT" : "UNAUTHORIZED",
                                                        (r && r.errorText) || "The sign-in has ended");
                    return r.accessToken;
                });
            }
            if ((!force || (rejectedToken && rejectedToken !== t.accessToken)) &&
                (!t.expiresAt || t.expiresAt - 60000 > now().getTime())) return t.accessToken;
            if (!t.refreshToken) throw err("SIGNED_OUT", "The sign-in has ended; sign in again");
            if (refreshing && refreshing.generation === generation && refreshing.token === t.refreshToken) return refreshing.promise;
            var flight = { generation: generation, token: t.refreshToken, promise: null };
            refreshing = flight;
            flight.promise = setUp().then(function (r) {
                return discovery(r).then(function (d) {
                    currentSession(generation);
                    return http({ method: "POST", url: d.token_endpoint, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                              body: form({ grant_type: "refresh_token", refresh_token: t.refreshToken, client_id: r.account.clientId }) });
                });
            }).then(function (res) {
                currentSession(generation);
                if (res.status === 400 || res.status === 401) {
                    var b = null;
                    try { b = JSON.parse(res.body); } catch (e) { b = null; }
                    if (b && (b.error === "invalid_grant" || b.error === "invalid_token")) return endSession("Your " + ACCOUNT_NAME + " sign-in ended; sign in again", generation);
                }
                if (res.status !== 200) throw platform.http.apiError(res, "The account server");
                return keep(json(res), "code", generation).then(function (t2) { return t2.accessToken; });
            });
            function finish() { if (refreshing === flight) refreshing = null; }
            flight.promise = flight.promise.then(function (token) { finish(); return token; }, function (e) { finish(); throw e; });
            return flight.promise;
        });
    }
    // The server no longer takes this device's tokens (signed out on the
    // web, the device removed): forget them here too.
    function endSession(text, generation) {
        if (generation !== undefined) currentSession(generation);
        var clearing = clearLocal(), invalidated = sessionGeneration;
        return clearing.then(function () {
            if (sessionGeneration === invalidated && !pending) {
                lastError = { errorCode: "SIGNED_OUT", errorText: text };
                changed();
            }
            throw err("SIGNED_OUT", text);
        });
    }
    function clearLocal() {
        var previous = sessionGeneration;
        var generation = ++sessionGeneration;
        // An old session ending does not cancel a new authorization which
        // has not committed credentials. Explicit cancel/reset detaches it.
        if (pending && !pending.committed && pending.generation === previous) pending.generation = generation;
        return tokenMutation(function () {
            return Promise.all([deps.keystore.del(TOKENS), deps.keystore.del(BACKUP)]);
        }).then(function () {
            if (generation !== sessionGeneration) return;
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
            var generation = sessionGeneration;
            var rejectedToken;
            var once = function (force) {
                currentSession(generation);
                return accessToken(force, rejectedToken).then(function (tok) {
                    currentSession(generation);
                    rejectedToken = tok;
                    var headers = { Authorization: "Bearer " + tok, Accept: "application/json" };
                    if (body !== undefined) headers["Content-Type"] = "application/json";
                    if (opts && opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
                    var req = { method: method, url: url, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) };
                    var response = opts && opts.bytes && deps.requestBytes
                        ? Promise.resolve(deps.requestBytes(req)).then(null, function (e) { throw err("CONNECTION_FAILED", "Cannot reach the " + ACCOUNT_NAME + " server (" + e.message + ")"); })
                        : http(req);
                    return response.then(function (res) {
                        return opts && opts.inspectResponse
                            ? Promise.resolve(opts.inspectResponse(res, req)).then(function () { return res; }) : res;
                    });
                });
            };
            return once(false).then(function (res) {
                currentSession(generation);
                return res.status === 401 ? once(true) : res;
            }).then(function (res) {
                currentSession(generation);
                if (res.status === 401) return endSession("Your " + ACCOUNT_NAME + " sign-in ended; sign in again", generation);
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

    function currentAttempt(mine) {
        if (pending !== mine || mine.generation !== sessionGeneration) throw err("CANCELED", "The sign-in was canceled");
    }
    function detachAttempt() {
        var mine = pending;
        if (mine && mine.timer) timers.clear(mine.timer);
        pending = null;
        return mine;
    }
    function revokeAttemptTokens(t, connection) {
        if (!t) return Promise.resolve();
        var result;
        if (t.via === "browser") result = deps.luna.call("luna://org.webosphoenix.service.oauth/forget", { keyId: t.keyId });
        else if (t.refreshToken && connection && connection.revocationEndpoint) {
            result = http({ method: "POST", url: connection.revocationEndpoint,
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: form({ token: t.refreshToken, token_type_hint: "refresh_token", client_id: connection.clientId }) });
        } else return Promise.resolve();
        return Promise.resolve(result).then(function () {}, function () { log("canceled sign-in token cleanup could not finish"); });
    }
    function cleanupRegistration(mine) {
        var reg = mine.registration;
        if (!reg || reg.cleaning) return Promise.resolve();
        reg.cleaning = true;
        return http({ method: "DELETE", url: reg.url + "/" + encodeURIComponent(reg.id),
            headers: { Authorization: reg.authorization, Accept: "application/json" } })
            .then(function () {}, function () { log("canceled sign-in registration cleanup could not finish"); });
    }
    function clearAttempt(mine) {
        if (!mine || !mine.committed || mine.generation !== sessionGeneration) return Promise.resolve();
        var kept = tokenMutation(function () { return deps.keystore.get(TOKENS); });
        var clear = clearLocal();
        mine.cleanup = kept.then(function (t) {
            var registered = mine.registrationPending || Promise.resolve();
            return registered.then(function () {}, function () {}).then(function () {
                return cleanupRegistration(mine);
            }).then(function () { return revokeAttemptTokens(t || mine.issuedTokens, mine.connection); });
        }).then(function () {}, function () { log("canceled sign-in cleanup could not finish"); });
        // Local cancellation is immediate; an outstanding registration reply
        // is cleaned at its original origin before its old tokens are revoked.
        return clear;
    }
    function failAttempt(mine, error) {
        if (pending !== mine) return mine.cleanup || Promise.resolve();
        detachAttempt();
        var clear = clearAttempt(mine);
        var generation = sessionGeneration;
        return clear.then(function () {
            if (generation !== sessionGeneration || pending) return;
            lastError = { errorCode: error.code || "UNKNOWN_ERROR", errorText: error.message };
            return changed();
        });
    }
    function cancelAttempt() {
        var mine = detachAttempt();
        return clearAttempt(mine).then(changed);
    }
    function signIn(p) {
        var method = p.method === "browser" ? "browser" : "code";
        if (pending || signingOut) return Promise.reject(err("BUSY", "An account transition is in progress"));
        var mine = { method: method, generation: sessionGeneration, committed: false, timer: null };
        pending = mine;
        return setUp().then(function (r) {
            currentAttempt(mine);
            return discovery(r).then(function (d) {
                currentAttempt(mine);
                mine.connection = { clientId: r.account.clientId, revocationEndpoint: d.revocation_endpoint || null };
                lastError = null;
                return method === "code" ? deviceCode(r, d, mine) : browser(r, d, mine);
            });
        }).then(null, function (e) {
            return failAttempt(mine, e).then(function () { throw e; });
        });
    }
    function commitAttempt(mine) {
        currentAttempt(mine);
        mine.generation = ++sessionGeneration;
        mine.committed = true;
    }

    function deviceCode(r, d, mine) {
        var endpoint = d.device_authorization_endpoint;
        if (typeof endpoint !== "string") throw err("BAD_SERVER", "The account server does not offer sign-in with a code");
        return http({ method: "POST", url: endpoint, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                      body: form({ client_id: r.account.clientId, scope: r.account.scope }) }).then(function (res) {
            currentAttempt(mine);
            if (res.status !== 200) throw platform.http.apiError(res, "The account server");
            var b = json(res);
            if (!b || typeof b.device_code !== "string" || typeof b.user_code !== "string" || typeof b.verification_uri !== "string")
                throw err("BAD_SERVER", "The account server's device code reply is incomplete");
            Object.assign(mine, {
                method: "code", deviceCode: b.device_code, userCode: b.user_code, verificationUri: b.verification_uri,
                verificationUriComplete: b.verification_uri_complete || null,
                expiresAt: new Date(now().getTime() + (b.expires_in || 600) * 1000).toISOString(),
                // RFC 8628 3.2: 5 seconds when the server says nothing.
                interval: Math.max(0, typeof b.interval === "number" ? b.interval : 5), tokenEndpoint: d.token_endpoint, timer: null
            });
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
            return http({ method: "POST", url: mine.tokenEndpoint, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                   body: form({ grant_type: DEVICE_GRANT, device_code: mine.deviceCode, client_id: r.account.clientId }) }).then(function (res) {
                var b = null;
                try { b = JSON.parse(res.body); } catch (e) { b = null; }
                if (pending !== mine) return res.status === 200 && b && typeof b.refresh_token === "string"
                    ? revokeAttemptTokens({ refreshToken: b.refresh_token }, mine.connection) : null;
                if (res.status === 200) {
                    mine.issuedTokens = b && typeof b.refresh_token === "string" ? { refreshToken: b.refresh_token } : null;
                    commitAttempt(mine);
                    return keep(b, "code", mine.generation).then(function () {
                        currentAttempt(mine);
                        return finishSignIn(mine);
                    });
                }
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
            }).then(null, function (e) { return failAttempt(mine, e); });
        }, mine.interval * 1000);
    }

    function failSignIn(code, text) {
        return pending ? failAttempt(pending, err(code, text)) : Promise.resolve();
    }

    function browser(r, d, mine) {
        if (typeof d.authorization_endpoint !== "string") throw err("BAD_SERVER", "The account server does not offer browser sign-in");
        changed();
        return deps.luna.call("luna://org.webosphoenix.service.oauth/authorize", {
            authorizationEndpoint: d.authorization_endpoint, tokenEndpoint: d.token_endpoint, clientId: r.account.clientId,
            scope: r.account.scope, revocationEndpoint: d.revocation_endpoint || undefined
        }).then(function (res) {
            if (pending !== mine || mine.generation !== sessionGeneration) {
                var forget = res && res.returnValue && res.keyId
                    ? deps.luna.call("luna://org.webosphoenix.service.oauth/forget", { keyId: res.keyId }).then(null, function () {})
                    : Promise.resolve();
                return forget.then(function () { throw err("CANCELED", "The sign-in was canceled"); });
            }
            if (!res || !res.returnValue) {
                var code = res && res.errorCode === "CANCELED" ? "CANCELED" : res && res.errorCode === "ACCESS_DENIED" ? "ACCESS_DENIED"
                    : (res && res.errorCode) || "UNKNOWN_ERROR";
                throw err(code, (res && res.errorText) || "The sign-in did not finish");
            }
            if (typeof res.keyId !== "string" || !res.keyId) throw err("BAD_SERVER", "The browser sign-in returned no key");
            mine.issuedTokens = { via: "browser", keyId: res.keyId };
            commitAttempt(mine);
            return storeTokens({ via: "browser", keyId: res.keyId, scope: res.scope || "" }, mine.generation).then(function () {
                currentAttempt(mine);
                return finishSignIn(mine);
            });
        });
    }

    // Signed in: this device registered, the account and its entitlements read.
    function finishSignIn(mine) {
        currentAttempt(mine);
        if (mine.timer) timers.clear(mine.timer);
        return Promise.all([apiJson("GET", "v1/me"), Promise.resolve(deps.device()), Promise.resolve(deps.crypto.deviceKey())]).then(function (got) {
            currentAttempt(mine);
            var me = got[0], dev = got[1] || {};
            var s = load();
            var previousDevice = s.accountId === me.id ? s.deviceId : null;
            // Every new grant needs its own server-side device association,
            // even when registration reuses this device's persistent key.
            var reg = apiJson("POST", "v1/devices", { publicKey: got[2], name: dev.name || "Phoenix device", model: dev.model || "",
                                                   compatible: dev.compatible || "", osVersion: dev.osVersion || "", build: dev.build || 0 },
                          { idempotencyKey: platform.b64.hex(deps.crypto.randomBytes(16)), inspectResponse: function (res, req) {
                              if (res.status < 200 || res.status >= 300) return;
                              var device = json(res);
                              if (!device || typeof device.id !== "string" || !device.id) return;
                              // Cancel may revoke this grant, but must not delete
                              // a previously linked device and its other sessions.
                              if (device.id !== previousDevice)
                                  mine.registration = { id: device.id, url: req.url, authorization: req.headers.Authorization };
                              if (pending !== mine || mine.generation !== sessionGeneration) return cleanupRegistration(mine);
                          } });
            mine.registrationPending = reg;
            return reg.then(function (d) {
                currentAttempt(mine);
                var s2 = load();
                s2.account = profile(me);
                s2.accountId = me.id;
                s2.deviceId = d.id;
                save(s2);
                return readEntitlements().then(null, function (e) { log("entitlements: " + e.message); });
            }).then(function () {
                // Signed in once all of it is there.
                currentAttempt(mine);
                var s3 = load();
                s3.signedIn = true;
                save(s3);
                pending = null;
                lastError = null;
            });
        }).then(function () {
            if (mine.generation !== sessionGeneration || pending) return changed();
            deps.luna.call("luna://com.webos.notification/createToast", {
                message: "Signed in to your " + ACCOUNT_NAME + " as " + ((load().account || {}).email || ""),
                onclick: { appId: "org.webosphoenix.settings", params: { page: "account" } }
            }).then(null, function () {});
            return changed();
        });
    }
    function profile(me) {
        return { id: me.id, name: me.name || "", email: me.email || "", emailVerified: !!me.emailVerified, avatar: me.avatar || null,
                 locale: me.locale || "", plan: me.plan || "free", deleting: me.deleting || null };
    }

    function signOut() {
        if (signingOut) return signingOut;
        var abandoned = detachAttempt();
        var settle = refreshing ? refreshing.promise.then(function () {}, function () {}) : tokenWrites;
        var work = settle.then(function () {
            return abandoned && abandoned.registrationPending
                ? abandoned.registrationPending.then(function () {}, function () {}) : null;
        }).then(status).then(function (st) {
            if (st.state === "notSetUp") throw err("NOT_SET_UP", "No " + ACCOUNT_NAME + " server is set up on this device");
            var s = load();
            var steps = s.deviceId
                ? apiJson("DELETE", "v1/devices/" + encodeURIComponent(s.deviceId)).then(null, function (e) { log("unregister: " + e.message); })
                : Promise.resolve();
            return steps.then(tokens).then(function (t) {
                if (!t) return null;
                if (t.via === "browser") return deps.luna.call("luna://org.webosphoenix.service.oauth/forget", { keyId: t.keyId }).then(null, function () {});
                // RFC 7009: the refresh token, so the pair is gone on the server.
                return setUp().then(function (r) {
                    return discovery(r).then(function (d) {
                        if (!d.revocation_endpoint || !t.refreshToken) return null;
                        return http({ method: "POST", url: d.revocation_endpoint, headers: { "Content-Type": "application/x-www-form-urlencoded" },
                                      body: form({ token: t.refreshToken, token_type_hint: "refresh_token", client_id: r.account.clientId }) });
                    });
                }).then(null, function (e) { log("revoke: " + e.message); });
            }).then(clearLocal).then(function () { lastError = null; return changed(); });
        });
        signingOut = work.then(function (result) { signingOut = null; return result; }, function (e) { signingOut = null; throw e; });
        return signingOut;
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
        var generation = sessionGeneration;
        return setUp().then(function (r) {
            currentSession(generation);
            return Promise.all([api("GET", "v1/me/entitlements", undefined, { bytes: true }), entitlementsKey(r)]).then(function (got) {
                var res = got[0];
                var bytes = res.bytes || platform.b64.utf8(res.body || "");
                var sig = platform.http.header(res, "X-Phoenix-Signature");
                if (!sig || !got[1]) throw err("BAD_SIGNATURE", "The entitlements are not signed");
                return platform.signed.verifyDetached(bytes, sig, got[1], deps.crypto.sha512).then(function (ok) {
                    currentSession(generation);
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
        var generation = sessionGeneration;
        function linked(deviceId) {
            currentSession(generation);
            var s = load();
            if (signingOut || (pending && pending.committed) || !s.signedIn || !s.deviceId || (deviceId && s.deviceId !== deviceId))
                throw err("SIGNED_OUT", "Sign in to your " + ACCOUNT_NAME + " first");
            return s.deviceId;
        }
        return setUp().then(function (r) {
            linked();
            if (!r.backup) throw err("NOT_SET_UP", "Phoenix Cloud backup is not set up on this device");
            return tokens().then(function (t) {
                var deviceId = linked();
                if (!t) throw err("SIGNED_OUT", "Sign in to your " + ACCOUNT_NAME + " first");
                if (backupFlight && backupFlight.generation === generation && backupFlight.deviceId === deviceId && backupFlight.api === r.api)
                    return backupFlight.promise;
                var flight = { generation: generation, deviceId: deviceId, api: r.api, promise: null };
                backupFlight = flight;
                flight.promise = Promise.resolve(deps.keystore.get(BACKUP)).then(function (kept) {
                    linked(deviceId);
                    // Older unbound cache records are replaced once. Never hand
                    // one account's device password to a later signed-in session.
                    if (kept && kept.deviceId === deviceId && kept.api === r.api && kept.url && kept.username && kept.password) return kept;
                    return apiJson("POST", "v1/backup/credentials", {}, { idempotencyKey: platform.b64.hex(deps.crypto.randomBytes(16)) }).then(function (c) {
                        linked(deviceId);
                        if (!c || typeof c.url !== "string" || !c.url || typeof c.username !== "string" || !c.username || typeof c.password !== "string" || !c.password)
                            throw err("BAD_SERVER", "The backup credentials are incomplete");
                        var rec = { url: c.url, username: c.username, password: c.password, deviceId: deviceId, api: r.api };
                        return tokenMutation(function () {
                            linked(deviceId);
                            return Promise.resolve(deps.keystore.put(BACKUP, rec)).then(function () {
                                linked(deviceId);
                                return rec;
                            });
                        });
                    });
                }).then(function (c) {
                    linked(deviceId);
                    return { returnValue: true, url: c.url, username: c.username, password: c.password };
                });
                function finish() { if (backupFlight === flight) backupFlight = null; }
                flight.promise = flight.promise.then(function (c) { finish(); return c; }, function (e) { finish(); throw e; });
                return flight.promise;
            });
        }).then(function (c) { linked(); return c; });
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
            if (signingOut) throw err("BUSY", "Sign-out is in progress");
            var abandoned = detachAttempt();
            var clear = abandoned && abandoned.committed && abandoned.generation === sessionGeneration ? clearAttempt(abandoned) : clearLocal();
            deps.override.write(o);
            // Another server: this device's sign-in belongs to the old one.
            return clear.then(function () {
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
        cancelSignIn: guard("cancelSignIn", cancelAttempt),
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
