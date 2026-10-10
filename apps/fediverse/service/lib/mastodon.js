// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Mastodon client API, which Mastodon, GoToSocial, Akkoma / Pleroma,
// Pixelfed and Friendica serve (docs/SYNERGY-MODERN.md 3.1), as the
// Fediverse connector uses it, over the kit's HTTP client (ctx.http: host
// allow-list, Retry-After backoff). Each call names the page of
// docs.joinmastodon.org it follows.
//
//   discover(http, handle) -> {acct, username, domain, server (https://host),
//                              software: {name, version}}
//       WebFinger on the handle's domain (RFC 7033;
//       https://docs.joinmastodon.org/spec/webfinger/) finds the account's
//       server, which may be another host than the handle's; NodeInfo
//       (https://github.com/jhass/nodeinfo/blob/main/PROTOCOL.md) names the
//       server's software. Servers without the Mastodon client API (Lemmy,
//       PeerTube, Misskey) are refused for now.
//   endpoints(http, server) -> {authorize, token, revoke}
//       RFC 8414 metadata (/.well-known/oauth-authorization-server, Mastodon
//       4.3 and later), else Mastodon's fixed paths
//       (https://docs.joinmastodon.org/methods/oauth/)
//   registerApp(http, server, redirectUri, scopes) -> {clientId, clientSecret}
//       POST /api/v1/apps (https://docs.joinmastodon.org/methods/apps/#create)
//   api(http, server, token) -> {get, post, upload}: Bearer calls under /api/

"use strict";

var synckit = require("@phoenix/synckit");

var SCOPES = "read:accounts read:follows read:notifications read:statuses write:statuses write:media";
var NO_CLIENT_API = ["lemmy", "peertube", "misskey", "sharkey", "firefish", "iceshrimp", "kbin", "mbin", "bookwyrm", "writefreely", "funkwhale"];

function fail(message, errorCode, status) {
    var e = new Error(message);
    e.errorCode = errorCode;
    if (status) e.status = status;
    return e;
}

// "@anna@example.social", "anna@example.social", "https://example.social/@anna" -> {username, domain}.
function parseHandle(text) {
    var s = String(text || "").trim();
    var m = /^https?:\/\/([^/]+)\/@([^/@?#]+)\/?$/i.exec(s);
    if (m) return { username: m[2], domain: m[1].toLowerCase() };
    m = /^@?([^@\s]+)@([^@\s/]+)$/.exec(s);
    if (m) return { username: m[1], domain: m[2].toLowerCase() };
    return null;
}

function originOf(url) {
    try { var u = new URL(url); return u.protocol + "//" + u.host; } catch (e) { return null; }
}

// HTTPS, but for a server on this computer's loopback (the tests' fake
// server, tools/test-fediverse.cjs), which is plain HTTP.
function base(domain) {
    return (/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(domain) ? "http" : "https") + "://" + domain;
}

function discover(http, handle) {
    var h = parseHandle(handle);
    if (!h) return Promise.reject(fail("Enter your address, like @you@example.social", "INVALID_USER"));
    http.allowHost(h.domain);
    var resource = "acct:" + h.username + "@" + h.domain;
    return http.json({ url: base(h.domain) + "/.well-known/webfinger?resource=" + encodeURIComponent(resource),
                       headers: { Accept: "application/jrd+json, application/json" } })
        .catch(function (e) {
            if (e.status === 404) throw fail("No account " + resource.slice(5) + " on that server", "INVALID_USER", 404);
            throw e;
        })
        .then(function (jrd) {
            var self = ((jrd && jrd.links) || []).filter(function (l) {
                return l.rel === "self" && /activity\+json|ld\+json/.test(l.type || "");
            })[0];
            var server = self ? originOf(self.href) : base(h.domain);
            if (!server) throw fail("The server's answer has no account address", "400_BAD_REQUEST");
            // The account's own name and domain as WebFinger gives them (aliases differ in case).
            var subject = /^acct:([^@]+)@(.+)$/.exec(String(jrd.subject || ""));
            var acct = subject ? { username: subject[1], domain: subject[2].toLowerCase() } : h;
            http.allowHost(new URL(server).host);
            return nodeinfo(http, server).then(function (software) {
                if (NO_CLIENT_API.indexOf(software.name) >= 0)
                    throw fail("This server runs " + software.name + ", which has no Mastodon client API: not supported yet", "UNSUPPORTED_CAPABILITY");
                return { acct: acct.username + "@" + acct.domain, username: acct.username, domain: acct.domain, server: server,
                         software: software };
            });
        });
}

// /.well-known/nodeinfo -> the newest schema's document -> {name, version}.
function nodeinfo(http, server) {
    return http.json({ url: server + "/.well-known/nodeinfo" }).then(function (index) {
        var links = ((index && index.links) || []).filter(function (l) { return /nodeinfo\.diaspora\.software\/ns\/schema\//.test(l.rel || ""); });
        links.sort(function (a, b) { return a.rel < b.rel ? 1 : -1; });
        if (!links.length) return { name: "unknown", version: "" };
        return http.json({ url: links[0].href }).then(function (doc) {
            var sw = (doc && doc.software) || {};
            return { name: String(sw.name || "unknown").toLowerCase(), version: String(sw.version || "") };
        });
    }, function () { return { name: "unknown", version: "" }; });
}

function endpoints(http, server) {
    var fallback = { authorize: server + "/oauth/authorize", token: server + "/oauth/token", revoke: server + "/oauth/revoke" };
    return http.json({ url: server + "/.well-known/oauth-authorization-server" }).then(function (meta) {
        var same = function (u) { return u && originOf(u) === server ? u : null; };
        return {
            authorize: same(meta && meta.authorization_endpoint) || fallback.authorize,
            token: same(meta && meta.token_endpoint) || fallback.token,
            revoke: same(meta && meta.revocation_endpoint) || fallback.revoke
        };
    }, function () { return fallback; });
}

function registerApp(http, server, redirectUri, scopes) {
    return http.json({
        method: "POST", url: server + "/api/v1/apps",
        json: { client_name: "webOS Phoenix", redirect_uris: redirectUri, scopes: scopes || SCOPES, website: "https://github.com/thebestbradley/webos-phoenix" }
    }).then(function (app) {
        if (!app || !app.client_id || !app.client_secret) throw fail("The server did not register the app", "400_BAD_REQUEST");
        return { clientId: String(app.client_id), clientSecret: String(app.client_secret) };
    });
}

function api(http, server, token) {
    var auth = { Authorization: "Bearer " + token };
    function url(path, query) {
        var q = Object.keys(query || {}).filter(function (k) { return query[k] !== undefined && query[k] !== null; }).map(function (k) {
            return [].concat(query[k]).map(function (v) { return encodeURIComponent(k) + "=" + encodeURIComponent(v); }).join("&");
        }).join("&");
        return /^https?:/.test(path) ? path : server + path + (q ? "?" + q : "");
    }
    return {
        get: function (path, query) { return http.json({ url: url(path, query), headers: auth }); },
        // With the Link header (paging, https://docs.joinmastodon.org/api/guidelines/#pagination).
        page: function (path, query) {
            return http.json({ url: url(path, query), headers: auth, withResponse: true }).then(function (r) {
                return { items: r.body || [], next: synckit.linkNext(r.headers.link) };
            });
        },
        post: function (path, body, headers) {
            return http.json({ method: "POST", url: url(path), headers: Object.assign({}, auth, headers || {}), json: body });
        },
        // multipart/form-data (RFC 7578), for /api/v2/media.
        upload: function (path, fields, file) {
            var boundary = "----phoenix" + Math.random().toString(36).slice(2) + Date.now().toString(36);
            var enc = function (s) { return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : new Uint8Array(Buffer.from(s, "utf8")); };
            var parts = [];
            Object.keys(fields).forEach(function (k) {
                if (fields[k] === undefined || fields[k] === null || fields[k] === "") return;
                parts.push(enc("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + k + "\"\r\n\r\n" + fields[k] + "\r\n"));
            });
            parts.push(enc("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" +
                           String(file.name).replace(/["\r\n]/g, "_") + "\"\r\nContent-Type: " + file.mimeType + "\r\n\r\n"));
            parts.push(file.bytes);
            parts.push(enc("\r\n--" + boundary + "--\r\n"));
            var n = 0;
            parts.forEach(function (p) { n += p.length; });
            var body = new Uint8Array(n), o = 0;
            parts.forEach(function (p) { body.set(p, o); o += p.length; });
            return http.json({ method: "POST", url: url(path), body: body,
                               headers: Object.assign({}, auth, { "Content-Type": "multipart/form-data; boundary=" + boundary }), withResponse: true });
        }
    };
}

module.exports = { SCOPES: SCOPES, parseHandle: parseHandle, discover: discover, nodeinfo: nodeinfo, endpoints: endpoints,
                   registerApp: registerApp, api: api, originOf: originOf };
