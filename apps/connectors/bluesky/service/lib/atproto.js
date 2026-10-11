// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The AT Protocol as the Bluesky connector uses it (https://atproto.com/specs):
//
//   identity  a handle -> its DID (https://atproto.com/specs/handle: the
//             HTTPS method, https://<handle>/.well-known/atproto-did; then
//             com.atproto.identity.resolveHandle at a resolver, as a DNS
//             TXT lookup is not open to a service) -> the DID document
//             (did:plc at the PLC directory, did:web at the host's
//             /.well-known/did.json) -> the account's PDS (the service
//             "#atproto_pds"), whose host is then reached
//   xrpc      GET /xrpc/<nsid>?params (queries) and POST /xrpc/<nsid> JSON
//             (procedures) at the PDS with the session's access token; the
//             PDS proxies app.bsky.* to the AppView and chat.bsky.* to the
//             chat service named in the atproto-proxy header
//             (did:web:api.bsky.chat#bsky_chat)
//   session   with an app password: com.atproto.server.createSession, then
//             refreshSession with the refresh token when the access token
//             has expired (ExpiredToken); sessions with OAuth: lib/oauth.js
//   richtext  a post's links as facets with UTF-8 byte offsets
//             (https://docs.bsky.app/docs/advanced-guides/post-richtext),
//             its length in graphemes (300 at most)

"use strict";

var CHAT_PROXY = "did:web:api.bsky.chat#bsky_chat";
var DEFAULTS = {
    resolver: "https://bsky.social",           // com.atproto.identity.resolveHandle (any PDS answers it)
    plc: "https://plc.directory",
    entryway: "https://bsky.social"            // createSession for bsky.social accounts without a DID document yet
};

function fail(message, errorCode, status) {
    var e = new Error(message);
    e.errorCode = errorCode;
    if (status) e.status = status;
    return e;
}

function jsonOf(res) {
    try { return res.body ? JSON.parse(res.body) : null; } catch (e) { return null; }
}

function hostOf(u) { try { return new URL(u).host; } catch (e) { return ""; } }

/** "@Anna.bsky.social" -> "anna.bsky.social"; null if it is not a handle. */
function normalizeHandle(h) {
    var s = String(h || "").trim().replace(/^@/, "").replace(/^at:\/\//, "").toLowerCase();
    if (/^did:(plc|web):/.test(s)) return s;
    if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s) || s.length > 253) return null;
    return s;
}

// handle -> did
function resolveHandle(ctx, handle, cfg) {
    if (/^did:/.test(handle)) return Promise.resolve(handle);
    ctx.http.allowHost(handle);
    var wellKnown = (cfg.wellKnown ? cfg.wellKnown.replace("{handle}", handle) : "https://" + handle + "/.well-known/atproto-did");
    return ctx.http.request({ method: "GET", url: wellKnown, headers: { Accept: "text/plain" }, timeoutMs: 8000 }).then(function (res) {
        var did = res.status === 200 ? String(res.body || "").trim() : "";
        if (/^did:(plc|web):[A-Za-z0-9._:%-]+$/.test(did)) return did;
        throw new Error("no well-known");
    }).catch(function () {
        var r = cfg.resolver || DEFAULTS.resolver;
        return ctx.http.request({ method: "GET", url: r + "/xrpc/com.atproto.identity.resolveHandle?handle=" + encodeURIComponent(handle),
                                  headers: { Accept: "application/json" } }).then(function (res) {
            var b = jsonOf(res) || {};
            if (res.status === 200 && b.did) return String(b.did);
            throw fail("No Bluesky account has the handle @" + handle, "INVALID_USER", res.status === 400 ? 0 : res.status);
        });
    });
}

// did -> its DID document
function didDocument(ctx, did, cfg) {
    var url;
    if (/^did:plc:/.test(did)) url = (cfg.plc || DEFAULTS.plc) + "/" + encodeURIComponent(did);
    else if (/^did:web:/.test(did)) {
        var host = decodeURIComponent(did.slice(8)).split(":")[0];
        ctx.http.allowHost(host);
        url = (cfg.didWeb ? cfg.didWeb.replace("{host}", host) : "https://" + host + "/.well-known/did.json");
    } else return Promise.reject(fail("Not a DID Bluesky uses: " + did, "400_BAD_REQUEST"));
    return ctx.http.request({ method: "GET", url: url, headers: { Accept: "application/json" } }).then(function (res) {
        var doc = jsonOf(res);
        if (res.status !== 200 || !doc || doc.id !== did) throw fail("The account's DID document could not be read (" + res.status + ")", "HOST_NOT_FOUND");
        return doc;
    });
}

function pdsOf(doc) {
    var s = (doc.service || []).filter(function (x) {
        return (x.id === "#atproto_pds" || x.id === doc.id + "#atproto_pds") && x.type === "AtprotoPersonalDataServer";
    })[0];
    if (!s || !/^https?:\/\//.test(String(s.serviceEndpoint || ""))) throw fail("The account names no PDS", "HOST_NOT_FOUND");
    return String(s.serviceEndpoint).replace(/\/+$/, "");
}

function handleOf(doc) {
    var aka = (doc.alsoKnownAs || []).filter(function (a) { return /^at:\/\//.test(a); })[0];
    return aka ? aka.slice(5) : "";
}

/** handle or DID -> {did, handle, pds} (the PDS's host may then be reached). */
function resolve(ctx, handleOrDid, cfg) {
    cfg = cfg || {};
    var h = normalizeHandle(handleOrDid);
    if (!h) return Promise.reject(fail("Not a Bluesky handle: " + handleOrDid + " (as anna.bsky.social)", "INVALID_USER"));
    return resolveHandle(ctx, h, cfg).then(function (did) {
        return didDocument(ctx, did, cfg).then(function (doc) {
            var pds = pdsOf(doc);
            var handle = handleOf(doc);
            // The handle must point back at the DID (bidirectional, atproto handle spec).
            if (!/^did:/.test(h) && handle && handle !== h) throw fail("@" + h + " does not belong to " + did, "INVALID_USER");
            ctx.http.allowHost(hostOf(pds));
            return { did: did, handle: handle || h, pds: pds };
        });
    });
}

// ---- XRPC ------------------------------------------------------------------------------

function xrpcError(res, nsid) {
    var b = jsonOf(res) || {};
    var name = String(b.error || "");
    var msg = (b.message || name || "HTTP " + res.status) + " (" + nsid + ")";
    if (res.status === 401 || name === "AuthenticationRequired" || name === "InvalidToken" || name === "AuthFactorTokenRequired")
        return fail(msg, "401_UNAUTHORIZED", 401);
    var e = fail(msg, name === "ExpiredToken" ? "EXPIRED_TOKEN" : "", res.status);
    e.xrpcError = name;
    return e;
}

function query(qs) {
    var parts = [];
    Object.keys(qs || {}).forEach(function (k) {
        var v = qs[k];
        if (v === undefined || v === null || v === "") return;
        (Array.isArray(v) ? v : [v]).forEach(function (x) { parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(x))); });
    });
    return parts.length ? "?" + parts.join("&") : "";
}

/**
 * A client of the account's PDS. auth: {header(method, url) -> Promise<{Authorization, DPoP?}>,
 * refresh() -> Promise (after ExpiredToken / a 401 once)}.
 */
function client(ctx, pds, auth) {
    function call(method, nsid, params, body, opts) {
        opts = opts || {};
        var url = pds + "/xrpc/" + nsid + (method === "GET" ? query(params) : "");
        function attempt(retried) {
            return auth.header(method, url).then(function (h) {
                var headers = Object.assign({ Accept: "application/json" }, h, opts.proxy ? { "atproto-proxy": opts.proxy } : {});
                var req = { method: method, url: url, headers: headers };
                if (opts.bytes) { req.body = opts.bytes; headers["Content-Type"] = opts.mimeType || "application/octet-stream"; }
                else if (method === "POST") { req.body = JSON.stringify(body || {}); headers["Content-Type"] = "application/json"; }
                return ctx.http.request(req);
            }).then(function (res) {
                if (res.status >= 200 && res.status < 300) return jsonOf(res) || {};
                var e = xrpcError(res, nsid);
                if (!retried && (e.xrpcError === "ExpiredToken" || e.status === 401 || (auth.retryOn && auth.retryOn(res)))) {
                    return auth.refresh(res).then(function () { return attempt(true); });
                }
                throw e;
            });
        }
        return attempt(false);
    }
    return {
        pds: pds,
        get: function (nsid, params, opts) { return call("GET", nsid, params, null, opts); },
        post: function (nsid, body, opts) { return call("POST", nsid, null, body, opts); },
        upload: function (bytes, mimeType) { return call("POST", "com.atproto.repo.uploadBlob", null, null, { bytes: bytes, mimeType: mimeType }); },
        chat: { proxy: CHAT_PROXY }
    };
}

// ---- Sessions with an app password -----------------------------------------------------

/** createSession -> {did, handle, accessJwt, refreshJwt, email?, active?} */
function createSession(ctx, pds, identifier, password) {
    return ctx.http.request({ method: "POST", url: pds + "/xrpc/com.atproto.server.createSession",
                              headers: { "Content-Type": "application/json", Accept: "application/json" },
                              body: JSON.stringify({ identifier: identifier, password: password }) }).then(function (res) {
        var b = jsonOf(res) || {};
        if (res.status === 200 && b.accessJwt) return b;
        if (b.error === "AuthFactorTokenRequired") throw fail("Use an app password (Bluesky's Settings, Privacy and security, App passwords), not your account's password", "401_UNAUTHORIZED", 401);
        if (res.status === 401 || res.status === 400) throw fail("Bluesky did not accept the handle and app password", "401_UNAUTHORIZED", 401);
        if (res.status === 429) { var e = fail("Too many sign-ins: try again later", "503_SERVICE_UNAVAILABLE", 429); throw e; }
        throw xrpcError(res, "com.atproto.server.createSession");
    });
}

function refreshSession(ctx, pds, refreshJwt) {
    return ctx.http.request({ method: "POST", url: pds + "/xrpc/com.atproto.server.refreshSession",
                              headers: { Authorization: "Bearer " + refreshJwt, Accept: "application/json" } }).then(function (res) {
        var b = jsonOf(res) || {};
        if (res.status === 200 && b.accessJwt) return b;
        throw xrpcError(res, "com.atproto.server.refreshSession");
    });
}

/**
 * The account's client with an app password: the session kept in store
 * ({get(), set(session)}: the connector's state), refreshed, or made again
 * with the password when the refresh token has gone too.
 */
function passwordClient(ctx, who, password, store) {
    var s = store.get();
    function fresh() {
        return createSession(ctx, who.pds, who.did, password).then(function (n) {
            s = { accessJwt: n.accessJwt, refreshJwt: n.refreshJwt };
            store.set(s);
        });
    }
    var auth = {
        header: function () {
            return (s && s.accessJwt ? Promise.resolve() : fresh()).then(function () { return { Authorization: "Bearer " + s.accessJwt }; });
        },
        refresh: function () {
            if (!s || !s.refreshJwt) return fresh();
            return refreshSession(ctx, who.pds, s.refreshJwt).then(function (n) {
                s = { accessJwt: n.accessJwt, refreshJwt: n.refreshJwt };
                store.set(s);
            }, function () { return fresh(); });
        }
    };
    return client(ctx, who.pds, auth);
}

// ---- Rich text ---------------------------------------------------------------------------

function utf8Length(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
        else n += 3;
    }
    return n;
}

/** Graphemes, as Bluesky counts a post's 300. */
function graphemes(s) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
        var n = 0, it = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s);
        for (var x of it) { void x; n++; }
        return n;
    }
    return Array.from(s).length;
}

/** The links in a post's text as app.bsky.richtext.facet#link facets (byte offsets). */
function linkFacets(text) {
    var out = [], re = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'}]/g, m;
    while ((m = re.exec(text))) {
        var start = utf8Length(text.slice(0, m.index));
        out.push({ index: { byteStart: start, byteEnd: start + utf8Length(m[0]) },
                   features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
    }
    return out;
}

/** "at://did/app.bsky.feed.post/rkey" -> the post's page on bsky.app. */
function postUrl(uri, handle) {
    var m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(String(uri || ""));
    return m ? "https://bsky.app/profile/" + (handle || m[1]) + "/post/" + m[2] : "";
}

module.exports = {
    DEFAULTS: DEFAULTS, CHAT_PROXY: CHAT_PROXY,
    normalizeHandle: normalizeHandle, resolve: resolve, resolveHandle: resolveHandle, didDocument: didDocument, pdsOf: pdsOf,
    client: client, createSession: createSession, refreshSession: refreshSession, passwordClient: passwordClient,
    utf8Length: utf8Length, graphemes: graphemes, linkFacets: linkFacets, postUrl: postUrl, fail: fail, jsonOf: jsonOf
};
