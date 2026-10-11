// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The local HTTP server the connectors' stand-ins for their providers run
// on (tests only, not shipped): each provider's fake (todoist.cjs,
// graph.cjs, google.cjs, bluesky.cjs, ...) adds its routes to it, so one
// server can play all of them (fake-providers.cjs: the Chromium tests and
// trying the connectors in the simulator).
//
//   const base = createFakeBase({autoApprove});
//   base.route(method | "*", /^\/path$/, (req, res, ctx) => ...)   ctx: {url, m, body, json(), form()}
//   base.oauthProvider(name, {secret?, scope?, pkce?: true})   /oauth/<name>/authorize|approve|token|revoke:
//       the authorization code flow as the providers document it: an Allow
//       page (or a redirect at once with autoApprove), codes bound to their
//       PKCE challenge, redirect URI and client, access tokens of an hour,
//       refresh tokens; the client secret checked when the provider asks
//       for one
//   base.bearer(req, name)   -> the token's record, or null (401 it)
//   base.issue(name)         -> a token answer without a sign-in (tests)
//   base.send(res, status, body, headers)
//   await base.start(0); base.origin; base.requests; base.stop()
//   base.conformance(request)  the kit's conformance suite's FakeServer:
//       every request 401 (unauthorized) or 429 with Retry-After (throttle)

"use strict";

const crypto = require("crypto");
const http = require("http");

function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]); }

function send(res, status, body, headers) {
    const h = Object.assign({}, headers || {});
    let data = body;
    if (body !== null && typeof body === "object" && !Buffer.isBuffer(body)) {
        data = JSON.stringify(body);
        if (!h["Content-Type"]) h["Content-Type"] = "application/json; charset=utf-8";
    }
    res.writeHead(status, h);
    res.end(data === undefined || data === null ? "" : data);
}

function createFakeBase(options) {
    options = options || {};
    const base = { origin: "", requests: [], autoApprove: !!options.autoApprove, offline: false, unauthorizedAll: false, throttleSeconds: 0,
                   revoked: [], send, b64url, esc };
    const routes = [];
    const providers = {};
    const codes = new Map(), tokens = new Map(), refresh = new Map();

    base.route = (method, re, fn) => { routes.push({ method, re, fn }); return base; };

    base.issue = (provider, extra) => {
        const access = "at-" + provider + "-" + crypto.randomBytes(8).toString("hex");
        const rt = "rt-" + provider + "-" + crypto.randomBytes(8).toString("hex");
        tokens.set(access, Object.assign({ provider, expires: Date.now() + 3600e3 }, extra || {}));
        refresh.set(rt, Object.assign({ provider }, extra || {}));
        return { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: rt, scope: (providers[provider] && providers[provider].scope) || "" };
    };
    base.bearer = (req, provider) => {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
        const t = m && tokens.get(m[1]);
        return t && (!provider || t.provider === provider) && t.expires > Date.now() ? t : null;
    };
    base.expireTokens = () => { for (const t of tokens.values()) t.expires = 0; };

    // The authorization code flow of one provider (docs above).
    base.oauthProvider = (name, opts) => {
        providers[name] = Object.assign({ pkce: true }, opts || {});
        base.client = base.client || {};
        return base;
    };
    function oauth(req, res, url, provider, step, body) {
        const p = providers[provider];
        const clientId = "phoenix-test-" + provider;
        if (step === "authorize") {
            const q = url.searchParams;
            if (q.get("client_id") !== clientId) return send(res, 400, "unknown client " + q.get("client_id"));
            if (p.pkce && (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge"))) return send(res, 400, "PKCE required");
            const approve = "/oauth/" + provider + "/approve?" + q.toString();
            if (base.autoApprove) { res.writeHead(302, { Location: approve }); return res.end(); }
            return send(res, 200, "<!doctype html><meta name=viewport content='width=device-width'><title>Sign in</title>" +
                "<body style='font-family:sans-serif;padding:16px'><h2>Test " + esc(provider) + "</h2><p>Allow webOS Phoenix?</p>" +
                "<p style='color:#666'>Asked for: " + esc(q.get("scope") || "") + "</p>" +
                "<a id=allow href='" + esc(approve) + "' style='display:inline-block;padding:10px 18px;background:#2b6;color:#fff;border-radius:6px'>Allow</a> " +
                "<a id=deny href='" + esc(q.get("redirect_uri") + "?error=access_denied&state=" + encodeURIComponent(q.get("state"))) + "'>Deny</a></body>",
                { "Content-Type": "text/html" });
        }
        if (step === "approve") {
            const q = url.searchParams;
            const code = "code-" + crypto.randomBytes(8).toString("hex");
            codes.set(code, { provider, challenge: q.get("code_challenge"), redirect: q.get("redirect_uri"), client: q.get("client_id"), scope: q.get("scope") });
            const to = q.get("redirect_uri") + (q.get("redirect_uri").indexOf("?") < 0 ? "?" : "&") + "code=" + code + "&state=" + encodeURIComponent(q.get("state"));
            res.writeHead(302, { Location: to });
            return res.end();
        }
        if (step === "token" && req.method === "POST") {
            const f = new URLSearchParams(body.toString("utf8"));
            // Basic client authentication (Zoom's, LinkedIn's) or the form's.
            const basic = /^Basic (.+)$/.exec(req.headers.authorization || "");
            const [bid, bsecret] = basic ? Buffer.from(basic[1], "base64").toString("utf8").split(":") : [];
            const id = f.get("client_id") || bid;
            const secret = f.get("client_secret") || bsecret;
            if (id !== clientId) return send(res, 401, { error: "invalid_client" });
            if (p.secret && secret !== p.secret) return send(res, 401, { error: "invalid_client", error_description: "client secret" });
            if (f.get("grant_type") === "authorization_code" || (!f.get("grant_type") && f.get("code"))) {
                const c = codes.get(f.get("code"));
                codes.delete(f.get("code"));
                if (!c || c.provider !== provider || (f.get("redirect_uri") && c.redirect !== f.get("redirect_uri"))) return send(res, 400, { error: "invalid_grant" });
                if (p.pkce && b64url(crypto.createHash("sha256").update(f.get("code_verifier") || "").digest()) !== c.challenge)
                    return send(res, 400, { error: "invalid_grant", error_description: "PKCE" });
                return send(res, 200, base.issue(provider, { scope: c.scope }));
            }
            if (f.get("grant_type") === "refresh_token") {
                const r = refresh.get(f.get("refresh_token"));
                if (!r || r.provider !== provider) return send(res, 400, { error: "invalid_grant" });
                const t = base.issue(provider, r);
                delete t.refresh_token;
                return send(res, 200, t);
            }
            return send(res, 400, { error: "unsupported_grant_type" });
        }
        if (step === "revoke") {
            const f = new URLSearchParams(body.toString("utf8"));
            const t = f.get("token") || url.searchParams.get("token");
            tokens.delete(t);
            base.revoked.push(provider);
            return send(res, 200, {});
        }
        return send(res, 404, "no such OAuth endpoint");
    }
    // What a connector's clients.json says for one of the fake's providers.
    base.clientOf = (provider, extra) => Object.assign({
        clientId: "phoenix-test-" + provider,
        authorizationEndpoint: base.origin + "/oauth/" + provider + "/authorize",
        tokenEndpoint: base.origin + "/oauth/" + provider + "/token",
        revocationEndpoint: base.origin + "/oauth/" + provider + "/revoke"
    }, providers[provider] && providers[provider].secret ? { clientSecret: providers[provider].secret } : {}, extra || {});

    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const body = Buffer.concat(chunks);
            const url = new URL(req.url, "http://localhost");
            base.requests.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, size: body.length,
                                 body: body.length < 65536 ? body.toString("utf8") : "" });
            if (base.offline) { req.socket.destroy(); return; }
            if (base.unauthorizedAll && !/^\/oauth\//.test(url.pathname)) return send(res, 401, { error: "unauthorized" });
            if (base.throttleSeconds) return send(res, 429, { error: "rate_limited" }, { "Retry-After": String(base.throttleSeconds) });
            try {
                let m = /^\/oauth\/([a-z0-9-]+)\/(authorize|approve|token|revoke)$/.exec(url.pathname);
                if (m && providers[m[1]]) return oauth(req, res, url, m[1], m[2], body);
                for (const r of routes) {
                    if (r.method !== "*" && r.method !== req.method) continue;
                    m = r.re.exec(url.pathname);
                    if (!m) continue;
                    const ctx = { url, m, body, query: url.searchParams,
                                  json: () => { try { return JSON.parse(body.toString("utf8") || "null"); } catch (e) { return null; } },
                                  form: () => new URLSearchParams(body.toString("utf8")) };
                    const out = r.fn(req, res, ctx);
                    if (out !== false) return undefined;
                }
                return send(res, 404, { error: "not_found", message: "no route " + req.method + " " + url.pathname });
            } catch (e) {
                return send(res, 500, String(e && e.stack || e));
            }
        });
    });
    base.conformance = (request) => ({
        request, requests: () => base.requests.length,
        unauthorized: (on) => { base.unauthorizedAll = !!on; },
        throttle: (secs) => { base.throttleSeconds = secs || 0; }
    });
    base.start = (port) => new Promise((resolve) => server.listen(port || 0, "127.0.0.1", () => {
        base.origin = "http://127.0.0.1:" + server.address().port;
        resolve(base);
    }));
    base.stop = () => new Promise((resolve) => { if (server.closeAllConnections) server.closeAllConnections(); server.close(() => resolve()); });
    return base;
}

module.exports = { createFakeBase, send, b64url, esc };
