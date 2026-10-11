#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A mock Phoenix platform: exactly the endpoints of docs/PLATFORM.md that a
// device calls, as docs/platform-api/openapi.yaml specifies them, with real
// Ed25519 signatures from test keys (keys.cjs). It stands in for the Laravel
// platform in the conformance suite (tools/test-platform-client.cjs) and in
// the simulator; the same suite runs against the real platform's staging
// server (docs/PLATFORM-CLIENT.md, "Conformance").
//
// One port, two "hosts" as paths:
//   <url>/feeds/   the static feeds (feeds.<domain>): catalog/v1/, updates/,
//                  revocations/v1/revoked.json, connect/generate_204
//   <url>/api/     the device API (api.<domain>): /.well-known/openid-
//                  configuration, /oauth/*, /v1/*, /dav/backups/*,
//                  /drivers/v1/report, and the conformance controls
//                  /v1/conformance/* (Bearer <token>) that publish releases,
//                  catalogs and revocations and approve sign-ins, which the
//                  real platform's staging must offer the same way
//
//   node tools/platform-mock/server.cjs [--port 8099] [--host 127.0.0.1]
//        [--token TOKEN] [--write-servers FILE] [--seed]
//
// --write-servers writes a servers.json (or a Developer Mode override) for
// it, with its keys pinned; --seed publishes a sample catalog (a web app
// package, a connector), an update for phoenix-sim and a revocation list.
//
// require("./server.cjs").start({port, token, interval}) -> Promise<mock>:
// {url, feeds, api, servers(), keys, publishUpdate, publishCatalog,
//  publishRevocations, approve, deny, rotate, state, close}.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const keysLib = require("./keys.cjs");

const DAY = 86400000;

function iso(t) { return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"); }
function rand(n) { return crypto.randomBytes(n || 16).toString("hex"); }
function b64url(buf) { return Buffer.from(buf).toString("base64url"); }

function start(opts) {
    opts = opts || {};
    const token = opts.token || "conformance";
    const interval = opts.interval === undefined ? 1 : opts.interval;
    const now = opts.now || (() => Date.now());

    // ---- Keys ---------------------------------------------------------------------------
    const keys = {
        catalogRoot: keysLib.keypair(), catalog: keysLib.keypair(),
        updatesRoot: keysLib.keypair(), updates: keysLib.keypair(),
        entitlements: keysLib.keypair()
    };
    const delegations = { catalog: [], updates: [] };
    function delegateAll() {
        delegations.catalog = [keysLib.delegate(keys.catalogRoot, keys.catalog, "catalog", iso(now() - DAY), iso(now() + 90 * DAY))];
        delegations.updates = [keysLib.delegate(keys.updatesRoot, keys.updates, "updates", iso(now() - DAY), iso(now() + 90 * DAY))];
    }
    delegateAll();

    // ---- State --------------------------------------------------------------------------
    const files = new Map();        // feeds path -> {body: Buffer, type, cache}
    const st = {
        users: { u_test: { id: "u_test", name: "Test Person", email: "test@example.org", emailVerified: true, avatar: null, locale: "en-US",
                           created: "2026-10-01T00:00:00Z", plan: "cloud", deleting: null } },
        deviceCodes: new Map(),     // device_code -> {userCode, scope, approved, denied, expires, lastPoll}
        authCodes: new Map(),       // code -> {challenge, redirectUri, user, scope}
        tokens: new Map(),          // access token -> {user, device, scope, expires}
        refresh: new Map(),         // refresh token -> {user, scope}
        devices: new Map(),         // id -> {id, user, name, model, compatible, osVersion, build, publicKey, created, lastSeen}
        davPasswords: new Map(),    // deviceId -> password
        dav: new Map(),             // "<deviceId>/<name>" -> {body, modified}
        channels: new Map(),
        broker: new Map(),          // handle -> {challenge, tokens, expires}
        assistantUsed: 0, assistantQuota: opts.assistantQuota || 1000,
        quotaBytes: opts.quotaBytes || 50 * 1024 * 1024,
        catalogBuild: 0, updateSequence: {}, revocationSequence: 0,
        log: []                      // every request: "METHOD path"
    };

    let base = "";
    const feedsPath = "/feeds/", apiPath = "/api/";
    const feedsUrl = () => base + feedsPath;
    const apiUrl = () => base + apiPath;
    const issuer = () => base + "/api";

    function put(p, body, type, cache) {
        files.set(p, { body: Buffer.isBuffer(body) ? body : Buffer.from(body), type: type || "application/json", cache: cache || "no-cache" });
    }
    function json(o) { return Buffer.from(JSON.stringify(o, null, 4) + "\n"); }
    function signed(p, bytes, key) {
        // The signature first, as the publisher does (a reader never sees a
        // file without its signature: server/marketplace Catalog::publish).
        put(p + ".sig", Buffer.from(keysLib.sigFile(key, bytes)), "text/plain");
        put(p, bytes);
    }
    function keyFile(scope) {
        const k = scope === "catalog" ? keys.catalog : keys.updates;
        return json({ key: k.publicKey, name: "Phoenix " + scope + " (mock)", fingerprint: k.fingerprint, delegations: delegations[scope] });
    }
    function writeKeys() {
        put("catalog/v1/key.json", keyFile("catalog"));
        put("updates/key.json", keyFile("updates"));
    }
    writeKeys();

    // ---- Publishing (the release console and the publisher) ----------------------------------

    // A system update: {compatible, channel, version, build, notes, bundle
    // (Buffer), rollout?, revoked?, release: null to withdraw, expires?}
    function publishUpdate(o) {
        const compatible = o.compatible || "phoenix-sim", channel = o.channel || "stable";
        const k = compatible + "/" + channel;
        st.updateSequence[k] = (st.updateSequence[k] || 0) + 1;
        let release = null;
        if (o.release !== null && o.version) {
            const bundle = Buffer.isBuffer(o.bundle) ? o.bundle : Buffer.from(o.bundle || "", o.bundleBase64 ? "base64" : "utf8");
            const name = "phoenix-" + o.version + ".raucb";
            put("updates/" + compatible + "/" + name, bundle, "application/octet-stream", "public, max-age=31536000, immutable");
            release = { name: o.name || "webOS Phoenix", version: o.version, build: o.build, date: o.date || iso(now()).slice(0, 10),
                        notes: o.notes || [], url: name, size: bundle.length, sha256: crypto.createHash("sha256").update(bundle).digest("hex") };
            if (o.rollout) release.rollout = o.rollout;
        }
        const doc = { format: 2, compatible, channel, sequence: o.sequence || st.updateSequence[k], generated: iso(now()),
                      expires: o.expires || iso(now() + 14 * DAY), revoked: o.revoked || [], release };
        signed("updates/" + compatible + "/" + channel + ".json", json(doc), o.signWith || keys.updates);
        return doc;
    }

    // The catalog: {apps: [{id, kind, title, ..., package: Buffer (ipk/connector)}],
    // accounts, revoked, categories}. Writes index.json as Catalog::publish does.
    function publishCatalog(o) {
        st.catalogBuild += 1;
        const root = feedsUrl() + "catalog/v1/";
        const apps = (o.apps || []).map((a) => {
            const e = Object.assign({ developer: { name: "Example" }, summary: "", description: "", categories: [], screenshots: [],
                                      license: "Apache-2.0", homepage: "", donation: "", featured: false, rating: null, version: "1.0.0" }, a);
            delete e.package;
            if (!e.icon) {
                put("catalog/v1/icons/" + a.id + ".svg", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#3a6ea5"/></svg>`),
                    "image/svg+xml", "public, max-age=86400");
                e.icon = root + "icons/" + a.id + ".svg";
            }
            if (a.package) {
                const pkg = Buffer.isBuffer(a.package) ? a.package : Buffer.from(a.package, "base64");
                const file = "packages/" + a.id + "_" + e.version + "_all.ipk";
                put("catalog/v1/" + file, pkg, "application/vnd.debian.binary-package", "public, max-age=31536000, immutable");
                e.release = Object.assign({ url: root + file, size: pkg.length, sha256: crypto.createHash("sha256").update(pkg).digest("hex") },
                                          a.rollout ? { rollout: a.rollout } : {});
                delete e.rollout;
            }
            return e;
        });
        const idx = { version: 1, build: o.build || st.catalogBuild, generated: iso(now()), expires: o.expires || iso(now() + 14 * DAY),
                      source: { id: "phoenix", name: "Phoenix Marketplace (mock)" },
                      categories: o.categories || Array.from(new Set(apps.flatMap((a) => a.categories))).sort(),
                      apps, accounts: o.accounts || [] };
        if (o.revoked) idx.revoked = o.revoked;
        signed("catalog/v1/index.json", json(idx), o.signWith || keys.catalog);
        return idx;
    }

    // {apps: [{id, kind, reason, date, text}], keys: [b64]}
    function publishRevocations(o) {
        st.revocationSequence += 1;
        const doc = { format: 1, sequence: o.sequence || st.revocationSequence, generated: iso(now()), expires: o.expires || iso(now() + 14 * DAY),
                      apps: o.apps || [], keys: o.keys || [] };
        signed("revocations/v1/revoked.json", json(doc), o.signWith || keys.catalog);
        return doc;
    }

    // A new online key for scope, delegated by its root (key rotation).
    function rotate(scope) {
        if (scope === "catalog") keys.catalog = keysLib.keypair();
        else keys.updates = keysLib.keypair();
        const root = scope === "catalog" ? keys.catalogRoot : keys.updatesRoot;
        const k = scope === "catalog" ? keys.catalog : keys.updates;
        delegations[scope] = [keysLib.delegate(root, k, scope, iso(now() - DAY), iso(now() + 90 * DAY))].concat(delegations[scope]).slice(0, 2);
        writeKeys();
        return k.publicKey;
    }

    put("connect/generate_204", Buffer.alloc(0), "text/plain");

    // ---- Accounts ---------------------------------------------------------------------------

    function approve(userCode, user) {
        for (const d of st.deviceCodes.values()) if (d.userCode === userCode) { d.approved = user || "u_test"; return true; }
        return false;
    }
    function deny(userCode) {
        for (const d of st.deviceCodes.values()) if (d.userCode === userCode) { d.denied = true; return true; }
        return false;
    }
    function issue(user, scope, device) {
        const access = "at_" + rand(), refresh = "rt_" + rand();
        st.tokens.set(access, { user, scope, device: device || null, expires: now() + 3600 * 1000 });
        st.refresh.set(refresh, { user, scope, device: device || null });
        return { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: refresh, scope };
    }
    function bearer(req) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
        const t = m && st.tokens.get(m[1]);
        return t && t.expires > now() ? Object.assign({ token: m[1] }, t) : null;
    }
    function entitlements(user) {
        const used = Array.from(st.dav.values()).reduce((n, f) => n + f.body.length, 0);
        return { plan: st.users[user].plan, features: {
            backup: { quotaBytes: st.quotaBytes, usedBytes: used }, pushRelay: { channels: 50 },
            assistant: { monthlyTokens: st.assistantQuota, usedTokens: st.assistantUsed }, messaging: false, fediverse: false },
            validUntil: iso(now() + 30 * DAY), graceDays: 7, issued: iso(now()) };
    }

    // ---- HTTP ------------------------------------------------------------------------------

    function send(res, status, body, headers) {
        const buf = body === undefined || body === null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
        res.writeHead(status, Object.assign({ "Content-Type": "application/json", "Content-Length": String(buf.length),
                                              "Access-Control-Allow-Origin": "*" }, headers || {}));
        res.end(buf);
    }
    // PLATFORM.md 5: {"error", "code", "details"?}
    function error(res, status, text, code, details, headers) {
        send(res, status, Object.assign({ error: text, code }, details ? { details } : {}), headers);
    }
    function body(req) {
        return new Promise((resolve) => {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => resolve(Buffer.concat(chunks)));
        });
    }
    function parse(req, buf) {
        const type = String(req.headers["content-type"] || "");
        if (type.indexOf("application/x-www-form-urlencoded") === 0) return Object.fromEntries(new URLSearchParams(buf.toString("utf8")));
        if (!buf.length) return {};
        try { return JSON.parse(buf.toString("utf8")); } catch (e) { return null; }
    }

    function serveFeed(req, res, p) {
        const f = files.get(p);
        if (!f) return error(res, 404, "Not found", "NOT_FOUND");
        const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ""));
        const headers = { "Content-Type": f.type, "Cache-Control": f.cache, "Accept-Ranges": "bytes" };
        if (range) {
            const from = Number(range[1]), to = range[2] ? Number(range[2]) : f.body.length - 1;
            if (from >= f.body.length) return send(res, 416, null, Object.assign(headers, { "Content-Range": "bytes */" + f.body.length }));
            return send(res, 206, f.body.subarray(from, to + 1), Object.assign(headers, { "Content-Range": `bytes ${from}-${to}/${f.body.length}` }));
        }
        send(res, 200, req.method === "HEAD" ? null : f.body, headers);
    }

    async function handleApi(req, res, p, url) {
        const raw = await body(req);
        const b = parse(req, raw);
        // WebDAV bodies are XML or the backup file: not JSON.
        if (b === null && !/^dav\//.test(p)) return error(res, 400, "The body is not JSON", "BAD_REQUEST");
        const m = (re) => re.exec(p);
        let x;

        // -- Conformance controls (staging only on the real platform) --
        if ((x = m(/^v1\/conformance\/(\w+)$/)) && req.method === "POST") {
            if (req.headers.authorization !== "Bearer " + token) return error(res, 401, "Conformance token required", "UNAUTHORIZED");
            const what = x[1];
            if (what === "updates") {
                if (b.bundleBase64) b.bundle = Buffer.from(b.bundleBase64, "base64");
                return send(res, 200, publishUpdate(b));
            }
            if (what === "catalog") return send(res, 200, publishCatalog(b));
            if (what === "revocations") return send(res, 200, publishRevocations(b));
            if (what === "approve") return send(res, approve(b.user_code) ? 200 : 404, { ok: true });
            if (what === "deny") return send(res, deny(b.user_code) ? 200 : 404, { ok: true });
            if (what === "rotate") return send(res, 200, { key: rotate(b.scope) });
            if (what === "keys") return send(res, 200, { catalogRoot: keys.catalogRoot.publicKey, catalog: keys.catalog.publicKey,
                                                          updatesRoot: keys.updatesRoot.publicKey, updates: keys.updates.publicKey,
                                                          entitlements: keys.entitlements.publicKey });
            if (what === "servers") return send(res, 200, servers(b.pin || "root"));
            return error(res, 404, "No such control", "NOT_FOUND");
        }

        // -- OpenID Connect discovery and OAuth (Passport) --
        if (p === ".well-known/openid-configuration") {
            return send(res, 200, { issuer: issuer(), authorization_endpoint: apiUrl() + "oauth/authorize", token_endpoint: apiUrl() + "oauth/token",
                                    device_authorization_endpoint: apiUrl() + "oauth/device/code", revocation_endpoint: apiUrl() + "oauth/revoke",
                                    userinfo_endpoint: apiUrl() + "v1/me", response_types_supported: ["code"],
                                    grant_types_supported: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
                                    code_challenge_methods_supported: ["S256"], scopes_supported: ["openid", "account", "backup", "push", "reviews", "assistant"],
                                    subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"] });
        }
        if (p === "oauth/device/code" && req.method === "POST") {
            if (b.client_id !== "phoenix-device") return send(res, 401, { error: "invalid_client" });
            const dc = rand(20), uc = rand(4).toUpperCase().replace(/(.{4})(.{4})/, "$1-$2");
            st.deviceCodes.set(dc, { userCode: uc, scope: b.scope || "", approved: null, denied: false, expires: now() + 600 * 1000, lastPoll: 0 });
            const verify = base + "/account/link";
            return send(res, 200, { device_code: dc, user_code: uc, verification_uri: verify, verification_uri_complete: verify + "?user_code=" + uc,
                                    expires_in: 600, interval });
        }
        if (p === "oauth/token" && req.method === "POST") {
            if (b.grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
                const d = st.deviceCodes.get(b.device_code);
                if (!d) return send(res, 400, { error: "invalid_grant" });
                if (d.expires < now()) return send(res, 400, { error: "expired_token" });
                if (d.denied) return send(res, 400, { error: "access_denied" });
                if (!d.approved) return send(res, 400, { error: "authorization_pending" });
                st.deviceCodes.delete(b.device_code);
                return send(res, 200, issue(d.approved, d.scope));
            }
            if (b.grant_type === "refresh_token") {
                const r = st.refresh.get(b.refresh_token);
                if (!r) return send(res, 400, { error: "invalid_grant" });
                st.refresh.delete(b.refresh_token);   // rotates on use
                return send(res, 200, issue(r.user, r.scope, r.device));
            }
            if (b.grant_type === "authorization_code") {
                const c = st.authCodes.get(b.code);
                if (!c) return send(res, 400, { error: "invalid_grant" });
                st.authCodes.delete(b.code);
                const s256 = b64url(crypto.createHash("sha256").update(String(b.code_verifier || "")).digest());
                if (s256 !== c.challenge || b.redirect_uri !== c.redirectUri) return send(res, 400, { error: "invalid_grant" });
                return send(res, 200, issue(c.user, c.scope));
            }
            return send(res, 400, { error: "unsupported_grant_type" });
        }
        if (p === "oauth/authorize" && req.method === "GET") {
            // The sign-in page: the mock approves at once for the test user.
            const q = url.searchParams;
            if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return error(res, 400, "PKCE (S256) is required", "BAD_REQUEST");
            const code = rand();
            st.authCodes.set(code, { challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), user: "u_test", scope: q.get("scope") || "" });
            const to = new URL(q.get("redirect_uri"));
            to.searchParams.set("code", code);
            if (q.get("state")) to.searchParams.set("state", q.get("state"));
            return send(res, 302, null, { Location: to.href });
        }
        if (p === "oauth/revoke" && req.method === "POST") {
            st.refresh.delete(b.token);
            st.tokens.delete(b.token);
            return send(res, 200, {});
        }
        // This platform's own servers.json, for Developer Mode's "use these servers".
        if (p === "v1/servers.json") return send(res, 200, servers(url.searchParams.get("pin") || "root"));
        if (p === "v1/key.json") return send(res, 200, { key: keys.entitlements.publicKey, name: "Phoenix API (mock)", fingerprint: keys.entitlements.fingerprint });
        if (p === "drivers/v1/report" && req.method === "POST") {
            if (!b || b.format !== 1 || !Array.isArray(b.devices)) return error(res, 400, "Not a format 1 hardware report", "BAD_REQUEST");
            return send(res, 201, { ok: true });
        }

        // -- WebDAV backups (Basic: device id + app password) --
        if ((x = m(/^dav\/backups\/([^/]+)\/?(.*)$/))) return dav(req, res, x[1], decodeURIComponent(x[2]), raw);

        // -- Everything below needs a token --
        if (/^v1\/oauth-broker\/[a-z0-9-]+\/authorize$/.test(p) && req.method === "GET") {
            const q = url.searchParams;
            const handle = rand();
            st.broker.set(handle, { challenge: q.get("code_challenge"), tokens: { access_token: "provider_at_" + rand(4), refresh_token: "provider_rt_" + rand(4),
                                                                                    token_type: "Bearer", expires_in: 3600 }, expires: now() + 120 * 1000 });
            const to = new URL(q.get("redirect_uri"));
            to.searchParams.set("handle", handle);
            to.searchParams.set("state", q.get("state") || "");
            return send(res, 302, null, { Location: to.href });
        }
        const auth = bearer(req);
        if (!auth) return error(res, 401, "Sign in first", "UNAUTHORIZED");
        const user = st.users[auth.user];

        if (p === "v1/me" && req.method === "GET") return send(res, 200, user);
        if (p === "v1/me" && req.method === "PATCH") {
            if (b.name !== undefined) user.name = String(b.name);
            if (b.locale !== undefined) user.locale = String(b.locale);
            return send(res, 200, user);
        }
        if (p === "v1/me/entitlements") {
            const bytes = Buffer.from(JSON.stringify(entitlements(auth.user)));
            return send(res, 200, bytes, { "X-Phoenix-Signature": keys.entitlements.sign(bytes) });
        }
        if (p === "v1/devices" && req.method === "POST") {
            const miss = ["publicKey", "name", "compatible"].filter((k) => typeof b[k] !== "string" || !b[k]);
            if (miss.length) return error(res, 422, "Missing " + miss.join(", "), "VALIDATION", Object.fromEntries(miss.map((k) => [k, "required"])));
            const id = "d_" + rand(6);
            const d = { id, user: auth.user, name: b.name, model: b.model || "", compatible: b.compatible, osVersion: b.osVersion || "", build: b.build | 0,
                        publicKey: b.publicKey, created: iso(now()), lastSeen: iso(now()).slice(0, 10) };
            st.devices.set(id, d);
            auth.device = id;
            st.tokens.get(auth.token).device = id;
            for (const r of st.refresh.values()) if (r.user === auth.user && !r.device) r.device = id;
            return send(res, 201, { id, name: d.name, created: d.created });
        }
        if (p === "v1/me/devices") {
            return send(res, 200, { items: Array.from(st.devices.values()).filter((d) => d.user === auth.user).map((d) => ({
                id: d.id, name: d.name, model: d.model, compatible: d.compatible, osVersion: d.osVersion, build: d.build, lastSeen: d.lastSeen,
                current: d.id === auth.device })), next: null });
        }
        if ((x = m(/^v1\/devices\/([^/]+)$/))) {
            const d = st.devices.get(x[1]);
            if (!d || d.user !== auth.user) return error(res, 404, "No such device", "NOT_FOUND");
            if (req.method === "PATCH") { d.name = String(b.name || d.name); return send(res, 200, d); }
            if (req.method === "DELETE") {
                st.devices.delete(x[1]);
                st.davPasswords.delete(x[1]);
                for (const [t, v] of st.tokens) if (v.device === x[1]) st.tokens.delete(t);
                for (const [t, v] of st.refresh) if (v.device === x[1]) st.refresh.delete(t);
                for (const [c, v] of st.channels) if (v.device === x[1]) st.channels.delete(c);
                return send(res, 204, null);
            }
        }
        if (p === "v1/backup/credentials" && req.method === "POST") {
            if (!auth.device) return error(res, 409, "Register this device first", "NO_DEVICE");
            const password = rand(12);
            st.davPasswords.set(auth.device, password);
            return send(res, 200, { url: apiUrl() + "dav/backups/" + auth.device + "/", username: auth.device, password });
        }
        if (p === "v1/backup/summary") {
            const devices = Array.from(st.devices.values()).filter((d) => d.user === auth.user).map((d) => ({
                deviceId: d.id, name: d.name, files: Array.from(st.dav.entries()).filter(([k]) => k.indexOf(d.id + "/") === 0)
                    .map(([k, f]) => ({ name: k.slice(d.id.length + 1), size: f.body.length, modified: f.modified })) }));
            const used = devices.reduce((n, d) => n + d.files.reduce((m2, f) => m2 + f.size, 0), 0);
            return send(res, 200, { usedBytes: used, quotaBytes: st.quotaBytes, devices });
        }
        if (p === "v1/push/channels" && req.method === "POST") {
            if (["graph", "google-calendar", "gmail"].indexOf(b.provider) < 0) return error(res, 422, "Unknown provider", "VALIDATION", { provider: "graph, google-calendar or gmail" });
            if (!/^https?:\/\//.test(b.endpoint || "") || !b.p256dh || !b.auth) return error(res, 422, "endpoint, p256dh and auth are required", "VALIDATION");
            const id = "ch_" + rand(8);
            const expiresAt = iso(now() + 3 * DAY);
            st.channels.set(id, { device: auth.device, provider: b.provider, endpoint: b.endpoint, expiresAt });
            const relay = b.provider === "graph" ? "relay/graph/" : b.provider === "gmail" ? "relay/google/pubsub/" : "relay/google/calendar/";
            return send(res, 201, { channelId: id, url: apiUrl() + relay + id, expiresAt });
        }
        if ((x = m(/^v1\/push\/channels\/([^/]+)(\/renew)?$/))) {
            const c = st.channels.get(x[1]);
            if (!c) return error(res, 404, "No such channel", "NOT_FOUND");
            if (x[2] && req.method === "POST") { c.expiresAt = iso(now() + 3 * DAY); return send(res, 200, { channelId: x[1], expiresAt: c.expiresAt }); }
            if (!x[2] && req.method === "DELETE") { st.channels.delete(x[1]); return send(res, 204, null); }
        }
        if ((x = m(/^v1\/oauth-broker\/([a-z0-9-]+)\/(redeem|refresh)$/)) && req.method === "POST") {
            if (x[2] === "redeem") {
                const h = st.broker.get(b.handle);
                if (!h || h.expires < now()) return error(res, 404, "No such handle", "NOT_FOUND");
                if (b64url(crypto.createHash("sha256").update(String(b.code_verifier || "")).digest()) !== h.challenge)
                    return error(res, 400, "The code verifier does not match", "BAD_VERIFIER");
                st.broker.delete(b.handle);   // nothing kept after redeem
                return send(res, 200, h.tokens);
            }
            if (!b.refresh_token) return error(res, 422, "refresh_token is required", "VALIDATION");
            return send(res, 200, { access_token: "provider_at_" + rand(4), refresh_token: b.refresh_token, token_type: "Bearer", expires_in: 3600 });
        }
        if (p === "v1/assistant/models") return send(res, 200, { object: "list", data: [{ id: "phoenix-assistant", object: "model", owned_by: "phoenix" }] });
        if (p === "v1/assistant/chat/completions" && req.method === "POST") {
            if (st.assistantUsed >= st.assistantQuota) return error(res, 429, "This month's assistant allowance is spent", "QUOTA", null, { "Retry-After": "3600" });
            const text = "Mock answer to: " + String(((b.messages || []).slice(-1)[0] || {}).content || "");
            st.assistantUsed += 10;
            return send(res, 200, { id: "chatcmpl-" + rand(4), object: "chat.completion", created: Math.floor(now() / 1000), model: b.model || "phoenix-assistant",
                                    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
                                    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } });
        }
        return error(res, 404, "No such endpoint", "NOT_FOUND");
    }

    function dav(req, res, deviceId, name, raw) {
        const m = /^Basic (.+)$/.exec(req.headers.authorization || "");
        const cred = m ? Buffer.from(m[1], "base64").toString("utf8").split(":") : [];
        if (!m || cred[0] !== deviceId || st.davPasswords.get(deviceId) !== cred.slice(1).join(":"))
            return send(res, 401, "", { "WWW-Authenticate": 'Basic realm="Phoenix Cloud"', "Content-Type": "text/plain" });
        const key = deviceId + "/" + name;
        if (req.method === "OPTIONS") return send(res, 200, "", { DAV: "1", Allow: "OPTIONS, PROPFIND, MKCOL, GET, PUT, DELETE" });
        if (req.method === "MKCOL") return send(res, name ? 403 : 405, "", { "Content-Type": "text/plain" });   // the folder exists
        if (req.method === "PROPFIND") {
            const href = apiPath + "dav/backups/" + deviceId + "/";
            const entries = Array.from(st.dav.entries()).filter(([k]) => k.indexOf(deviceId + "/") === 0);
            const resp = (h, f) => `<d:response><d:href>${h}</d:href><d:propstat><d:prop>${f ? `<d:getcontentlength>${f.body.length}</d:getcontentlength><d:getlastmodified>${new Date(f.modified).toUTCString()}</d:getlastmodified><d:resourcetype/>` : "<d:resourcetype><d:collection/></d:resourcetype>"}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
            const xml = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${resp(href)}${String(req.headers.depth) === "0" ? "" : entries.map(([k, f]) => resp(href + encodeURIComponent(k.slice(deviceId.length + 1)), f)).join("")}</d:multistatus>`;
            return send(res, 207, xml, { "Content-Type": "application/xml; charset=utf-8" });
        }
        if (req.method === "PUT") {
            const used = Array.from(st.dav.values()).reduce((n, f) => n + f.body.length, 0);
            if (used + raw.length > st.quotaBytes) return error(res, 507, "Your Phoenix Cloud storage is full", "QUOTA");
            const existed = st.dav.has(key);
            st.dav.set(key, { body: raw, modified: iso(now()) });
            return send(res, existed ? 204 : 201, "", { "Content-Type": "text/plain" });
        }
        if (req.method === "GET") {
            const f = st.dav.get(key);
            return f ? send(res, 200, f.body, { "Content-Type": "application/octet-stream" }) : send(res, 404, "", { "Content-Type": "text/plain" });
        }
        if (req.method === "DELETE") return send(res, st.dav.delete(key) ? 204 : 404, "", { "Content-Type": "text/plain" });
        return send(res, 405, "", { "Content-Type": "text/plain" });
    }

    // servers.json for this mock: pin "root" (the offline roots), "key" (the
    // online keys) or "none" (trust on first use, unsigned updates).
    function servers(pin) {
        pin = pin || "root";
        const p = (rootK, k) => pin === "root" ? { key: null, root: rootK.publicKey } : pin === "key" ? { key: k.publicKey, root: null } : { key: null, root: null };
        return {
            format: 1, name: "Mock Phoenix platform (" + base + ")",
            feeds: feedsUrl(), api: apiUrl(),
            catalog: Object.assign({ url: "catalog/v1/" }, p(keys.catalogRoot, keys.catalog)),
            updates: Object.assign({ url: "updates/", channel: "stable", channels: ["stable", "beta", "dev"] }, p(keys.updatesRoot, keys.updates)),
            revocations: { url: "revocations/v1/revoked.json" },
            drivers: { url: null, key: null, reportUrl: "drivers/v1/report" },
            account: { issuer: issuer(), clientId: "phoenix-device", scope: "openid account backup push reviews assistant", key: keys.entitlements.publicKey },
            push: { server: base + "/push/" },
            assistant: { url: "v1/assistant/" },
            connectivity: { probe: "connect/generate_204" }
        };
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://x");
        const p = decodeURIComponent(url.pathname);
        st.log.push(req.method + " " + url.pathname + url.search);
        try {
            if (req.method === "OPTIONS" && p.indexOf(apiPath + "dav/") !== 0)
                return send(res, 204, null, { "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key" });
            if (p.indexOf(feedsPath) === 0 && (req.method === "GET" || req.method === "HEAD")) return serveFeed(req, res, p.slice(feedsPath.length));
            if (p === "/account/link") return send(res, 200, "<!doctype html><title>Link a device</title><p>Enter the code shown on your device.</p>", { "Content-Type": "text/html" });
            if (p.indexOf(apiPath) === 0) return await handleApi(req, res, p.slice(apiPath.length), url);
            error(res, 404, "Not found", "NOT_FOUND");
        } catch (e) {
            error(res, 500, String(e && e.stack || e), "SERVER_ERROR");
        }
    });

    return new Promise((resolve) => {
        server.listen(opts.port || 0, opts.host || "127.0.0.1", () => {
            base = "http://" + (opts.host || "127.0.0.1") + ":" + server.address().port;
            publishCatalog({ apps: [] });
            resolve({
                get url() { return base; }, feeds: feedsUrl(), api: apiUrl(), issuer: issuer(), token, keys, state: st, files,
                servers, publishUpdate, publishCatalog, publishRevocations, approve, deny, rotate, delegations,
                close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); })
            });
        });
    });
}

// A sample: a web app package and a connector package (made with the
// Marketplace's own .ipk writer), an update for phoenix-sim, a revocation list.
async function seed(mock) {
    const zlib = require("zlib");
    const ipk = require(path.join(__dirname, "../../apps/marketplace/service/lib/ipk.js")).createIpk({
        gzip: { gzip: async (b) => new Uint8Array(zlib.gzipSync(b)), gunzip: async (b) => new Uint8Array(zlib.gunzipSync(b)) }
    });
    const pkg = await samplePackages(ipk);
    mock.publishCatalog({ apps: [
        { id: "org.example.mockapp", kind: "ipk", title: "Mock App", summary: "An app from the mock catalog", categories: ["Utilities"], featured: true,
          version: "1.0.0", package: Buffer.from(pkg.app) },
        { id: "org.example.mockfeeds", kind: "connector", title: "Mock Feeds", summary: "A connector from the mock catalog", categories: ["News"],
          version: "0.1.0", package: Buffer.from(pkg.connector) }
    ] });
    mock.publishUpdate({ compatible: "phoenix-sim", channel: "stable", version: "0.2.0", build: 2, notes: ["From the mock platform"],
                         bundle: "[update]\ncompatible=phoenix-sim\nversion=0.2.0\nbuild=2\n" });
    mock.publishRevocations({ apps: [] });
}

// The sample packages: {app, connector} as Uint8Array.
async function samplePackages(ipk, opts) {
    opts = opts || {};
    const appId = opts.appId || "org.example.mockapp", conId = opts.connectorId || "org.example.mockfeeds";
    const appVersion = opts.appVersion || "1.0.0";
    const icon = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const app = await ipk.write({
        control: { Package: appId, Version: appVersion, Architecture: "all", Description: "Mock App" },
        files: [
            { path: `usr/palm/applications/${appId}/appinfo.json`, data: JSON.stringify({ id: appId, version: appVersion, vendor: "Example", type: "web", main: "index.html", title: "Mock App", icon: "icon.png" }) },
            { path: `usr/palm/applications/${appId}/index.html`, data: `<!doctype html><title>Mock App</title><h1>Mock App ${appVersion}</h1>` },
            { path: `usr/palm/applications/${appId}/icon.png`, data: new Uint8Array(icon) }
        ]
    });
    const dir = `usr/palm/applications/${conId}/`;
    const connector = await ipk.write({
        control: { Package: conId, Version: "0.1.0", Architecture: "all", Description: "Mock Feeds" },
        files: [
            { path: dir + "appinfo.json", data: JSON.stringify({ id: conId, version: "0.1.0", vendor: "Example", type: "web", main: "index.html", title: "Mock Feeds", icon: "icon.png", visible: false }) },
            { path: dir + "index.html", data: "<!doctype html><title>Mock Feeds</title>" },
            { path: dir + "icon.png", data: new Uint8Array(icon) },
            { path: dir + "service/package.json", data: JSON.stringify({ name: conId + ".service", version: "0.1.0", main: "service.js" }) },
            { path: dir + "service/service.js", data: "module.exports = {};\n" },
            { path: dir + "service/sysbus/" + conId + ".service.role.json", data: JSON.stringify({ appId: conId + ".service", type: "regular", allowedNames: [conId + ".service"], permissions: [] }) }
        ]
    });
    return { app, connector };
}

module.exports = { start, seed, samplePackages };

if (require.main === module) {
    const args = process.argv.slice(2);
    const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    start({ port: Number(arg("--port", 8099)), host: arg("--host", "127.0.0.1"), token: arg("--token", "conformance") }).then(async (mock) => {
        if (args.includes("--seed")) await seed(mock);
        const out = arg("--write-servers", null);
        if (out) fs.writeFileSync(out, JSON.stringify(mock.servers(arg("--pin", "root")), null, 4) + "\n");
        console.log("Mock Phoenix platform at " + mock.url + " (feeds " + mock.feeds + ", api " + mock.api + "); conformance token: " + mock.token);
    });
}
