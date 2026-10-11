// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Matrix client-server API (https://spec.matrix.org/v1.16/client-server-api/)
// as the Matrix account uses it, over the kit's HTTP (ctx.http): discovery,
// sign-in, sync (simplified sliding sync, MSC4186, where the server has it;
// /v3/sync otherwise), sending, media and receipts. Plain CommonJS without
// dependencies, for a device, the simulator's page and Node's tests.
//
//   discover(http, userOrServer) -> {homeserver, userId?}
//   createApi(http, homeserver, token?) -> {get, post, put, ...}

"use strict";

var SLIDING = "org.matrix.simplified_msc3575";

function fail(message, errorCode, extra) {
    var e = new Error(message);
    e.errorCode = errorCode;
    return Object.assign(e, extra || {});
}

function isLoopback(host) { return /^(127\.\d+\.\d+\.\d+|localhost)(:\d+)?$/i.test(String(host)); }

// "@anna:example.org" -> "example.org"; "example.org" stays.
function serverNameOf(input) {
    var s = String(input || "").trim();
    var m = /^@[^:]+:(.+)$/.exec(s);
    if (m) return m[1].toLowerCase();
    return s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

function baseUrl(host) { return (isLoopback(host) ? "http://" : "https://") + host; }

// Client-server discovery (spec 2.2.1): /.well-known/matrix/client names
// the homeserver; without it the server name is the homeserver. Checked
// with /_matrix/client/versions.
function discover(http, input) {
    var name = serverNameOf(input);
    if (!name || !/^[a-z0-9.-]+(:\d+)?$/i.test(name)) return Promise.reject(fail("Enter your Matrix ID, like @you:matrix.org", "INVALID_USER"));
    http.allowHost(name);
    var homeserver = baseUrl(name);
    return http.request({ method: "GET", url: baseUrl(name) + "/.well-known/matrix/client" }).then(function (r) {
        if (r.status !== 200) return;
        try {
            var hs = JSON.parse(r.body || "{}")["m.homeserver"];
            if (hs && /^https?:\/\//.test(hs.base_url || "")) homeserver = String(hs.base_url).replace(/\/+$/, "");
        } catch (e) { /* not JSON: the server name itself */ }
    }, function () { /* no well-known: the server name itself */ }).then(function () {
        var u = new URL(homeserver);
        if (u.protocol !== "https:" && !isLoopback(u.host)) throw fail("The homeserver's address is not secure (" + homeserver + ")", "SSL_CERT_UNTRUSTED");
        http.allowHost(u.host);
        return http.request({ method: "GET", url: homeserver + "/_matrix/client/versions" });
    }).then(function (r) {
        if (r.status !== 200) throw fail("No Matrix homeserver answers for " + name, "HOST_NOT_FOUND");
        var v = {};
        try { v = JSON.parse(r.body || "{}"); } catch (e) { throw fail("No Matrix homeserver answers for " + name, "HOST_NOT_FOUND"); }
        var unstable = v.unstable_features || {};
        return { homeserver: homeserver, serverName: name, versions: v.versions || [], slidingSync: !!unstable[SLIDING] };
    });
}

function createApi(http, homeserver, token) {
    function headers(extra) {
        var h = Object.assign({ Accept: "application/json" }, extra || {});
        if (token) h.Authorization = "Bearer " + token;
        return h;
    }
    function errorOf(r) {
        var body = {};
        try { body = JSON.parse(r.body || "{}"); } catch (e) { body = {}; }
        var code = body.errcode || "";
        if (r.status === 401 || code === "M_UNKNOWN_TOKEN" || code === "M_MISSING_TOKEN")
            return fail(body.error || "Signed out on the server", "401_UNAUTHORIZED", { status: 401, matrix: code, softLogout: !!body.soft_logout });
        if (r.status === 403 && code === "M_FORBIDDEN") return fail(body.error || "Not allowed", "PERMISSION_DENIED", { status: 403, matrix: code });
        if (r.status === 404) return fail(body.error || "Not found", "NOT_FOUND", { status: 404, matrix: code });
        return fail(body.error || "The homeserver answered " + r.status, r.status >= 500 ? "500_SERVER_ERROR" : "400_BAD_REQUEST", { status: r.status, matrix: code });
    }
    function call(method, path, body, opts) {
        opts = opts || {};
        var req = { method: method, url: homeserver + path, headers: headers(opts.headers) };
        if (body instanceof Uint8Array) req.body = body;
        else if (body !== undefined) { req.body = JSON.stringify(body); req.headers["Content-Type"] = "application/json"; }
        if (opts.timeoutMs) req.timeoutMs = opts.timeoutMs;
        if (opts.binary) req.binary = true;
        return http.request(req).then(function (r) {
            if (r.status >= 200 && r.status < 300) {
                if (opts.binary) return r;
                try { return JSON.parse(r.body || "{}"); } catch (e) { throw fail("The homeserver's answer was not JSON", "500_SERVER_ERROR"); }
            }
            throw errorOf(r);
        });
    }
    function q(params) {
        var parts = [];
        Object.keys(params || {}).forEach(function (k) {
            if (params[k] !== undefined && params[k] !== null) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
        });
        return parts.length ? "?" + parts.join("&") : "";
    }
    function enc(s) { return encodeURIComponent(s); }

    return {
        homeserver: homeserver,
        setToken: function (t) { token = t; },
        call: call,
        loginFlows: function () { return call("GET", "/_matrix/client/v3/login"); },
        // Spec 4.1 (m.login.password), with the device's name.
        loginPassword: function (user, password, deviceId) {
            return call("POST", "/_matrix/client/v3/login", {
                type: "m.login.password", identifier: { type: "m.id.user", user: user }, password: password,
                initial_device_display_name: "webOS Phoenix", device_id: deviceId || undefined
            });
        },
        // OAuth 2.0 (MSC3861/MSC2965, spec 1.15 "OAuth 2.0 API"): the server's authorization metadata, or null.
        authMetadata: function () {
            return call("GET", "/_matrix/client/v1/auth_metadata").catch(function () {
                return call("GET", "/_matrix/client/unstable/org.matrix.msc2965/auth_metadata");
            }).catch(function () { return null; });
        },
        whoami: function () { return call("GET", "/_matrix/client/v3/account/whoami"); },
        logout: function () { return call("POST", "/_matrix/client/v3/logout", {}); },
        profile: function (userId) { return call("GET", "/_matrix/client/v3/profile/" + enc(userId)).catch(function () { return {}; }); },
        // MSC4186: the room list and each room's latest events, from pos on.
        slidingSync: function (body, pos, timeoutMs) {
            return call("POST", "/_matrix/client/unstable/" + SLIDING + "/sync" + q({ pos: pos, timeout: timeoutMs }), body,
                        { timeoutMs: (timeoutMs || 0) + 30000 });
        },
        sync: function (since, timeoutMs, filter) {
            return call("GET", "/_matrix/client/v3/sync" + q({ since: since, timeout: timeoutMs, filter: filter ? JSON.stringify(filter) : undefined }),
                        undefined, { timeoutMs: (timeoutMs || 0) + 30000 });
        },
        send: function (roomId, txnId, content, type) {
            return call("PUT", "/_matrix/client/v3/rooms/" + enc(roomId) + "/send/" + enc(type || "m.room.message") + "/" + enc(txnId), content);
        },
        receipt: function (roomId, eventId) {
            return call("POST", "/_matrix/client/v3/rooms/" + enc(roomId) + "/receipt/m.read/" + enc(eventId), {});
        },
        typing: function (roomId, userId, on) {
            return call("PUT", "/_matrix/client/v3/rooms/" + enc(roomId) + "/typing/" + enc(userId), on ? { typing: true, timeout: 20000 } : { typing: false });
        },
        createDirect: function (userId) {
            return call("POST", "/_matrix/client/v3/createRoom", { is_direct: true, invite: [userId], preset: "trusted_private_chat" });
        },
        joinRoom: function (roomId) { return call("POST", "/_matrix/client/v3/join/" + enc(roomId), {}); },
        accountData: function (userId, type) { return call("GET", "/_matrix/client/v3/user/" + enc(userId) + "/account_data/" + enc(type)).catch(function () { return {}; }); },
        setAccountData: function (userId, type, content) { return call("PUT", "/_matrix/client/v3/user/" + enc(userId) + "/account_data/" + enc(type), content); },
        upload: function (bytes, filename, contentType) {
            return call("POST", "/_matrix/media/v3/upload" + q({ filename: filename }), bytes, { headers: { "Content-Type": contentType } });
        },
        // Authenticated media (spec 1.11, MSC3916), else the old address.
        download: function (mxc) {
            var m = /^mxc:\/\/([^/]+)\/([^/?#]+)$/.exec(String(mxc || ""));
            if (!m) return Promise.reject(fail("Not a Matrix media address", "400_BAD_REQUEST"));
            var path = enc(m[1]) + "/" + enc(m[2]);
            return call("GET", "/_matrix/client/v1/media/download/" + path, undefined, { binary: true }).catch(function (e) {
                if (e.status !== 404 && e.status !== 400) throw e;
                return call("GET", "/_matrix/media/v3/download/" + path, undefined, { binary: true });
            });
        }
    };
}

module.exports = { discover: discover, createApi: createApi, serverNameOf: serverNameOf, isLoopback: isLoopback, SLIDING: SLIDING, fail: fail };
