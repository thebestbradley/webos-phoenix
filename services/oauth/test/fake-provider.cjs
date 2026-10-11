// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A fake OAuth 2.0 provider for the OAuth service's tests
// (services/oauth/oauth.test.ts, tools/test-signin-card.cjs): the
// authorization code grant (RFC 6749 4.1) with PKCE S256 required
// (RFC 7636), refresh tokens (6), revocation (RFC 7009), and loopback
// redirects matched as RFC 8252 7.3 asks (any port) or exactly
// ({exactRedirect: true}, as Dropbox does).
//
//   createFakeProvider({clientId, redirectUris, exactRedirect, expiresIn})
//     .start(port) -> Promise<provider>
//   provider.base, .stop(), .state(): {issued, refreshed, revoked, tokenRequests}
//
//   GET  /authorize   the sign-in page: "Fake Provider", the app's name,
//                     Allow and Deny (a form that POSTs back here)
//   POST /authorize   -> 302 to the redirect with code and state, or
//                     error=access_denied
//   POST /token       authorization_code (code, redirect_uri, client_id,
//                     code_verifier checked) or refresh_token
//   POST /revoke      the token, revoked
//   GET  /me          {name} with a live bearer token

"use strict";
const http = require("http");
const crypto = require("crypto");

function b64url(buf) { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c])); }

function loopbackMatch(a, b) {
    const re = /^http:\/\/127\.0\.0\.1(?::\d+)?(\/.*)$/;
    const ma = re.exec(a), mb = re.exec(b);
    return !!ma && !!mb && ma[1] === mb[1];
}

function createFakeProvider(opts) {
    opts = opts || {};
    const clientId = opts.clientId || "phoenix-test-client";
    const redirectUris = opts.redirectUris || ["http://127.0.0.1/oauth/callback"];
    const codes = {}, tokens = {}, refresh = {};
    const st = { issued: 0, refreshed: 0, revoked: [], tokenRequests: [], authorizeRequests: [] };
    let server = null;
    const p = { base: "", clientId };

    function redirectOk(uri) {
        return redirectUris.some((r) => r === uri || (!opts.exactRedirect && loopbackMatch(r, uri)));
    }
    function issue(scope) {
        const access = "at-" + b64url(crypto.randomBytes(12));
        const rt = "rt-" + b64url(crypto.randomBytes(12));
        tokens[access] = { scope, live: true };
        refresh[rt] = { scope, live: true };
        st.issued++;
        return { access_token: access, token_type: "Bearer", refresh_token: rt, scope, expires_in: opts.expiresIn || 3600 };
    }
    function body(req) {
        return new Promise((resolve) => {
            let b = "";
            req.on("data", (d) => { b += d; });
            req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(b))));
        });
    }
    function send(res, status, headers, text) {
        res.writeHead(status, headers);
        res.end(text || "");
    }
    function json(res, status, obj) { send(res, status, { "content-type": "application/json" }, JSON.stringify(obj)); }

    async function handle(req, res) {
        const u = new URL(req.url, p.base);
        if (u.pathname === "/authorize" && req.method === "GET") {
            const q = Object.fromEntries(u.searchParams);
            st.authorizeRequests.push(q);
            if (q.client_id !== clientId) return send(res, 400, { "content-type": "text/html" }, "<p>Unknown client</p>");
            if (!redirectOk(q.redirect_uri)) return send(res, 400, { "content-type": "text/html" }, "<p>The redirect_uri is not registered</p>");
            if (q.code_challenge_method !== "S256" || !q.code_challenge) return send(res, 400, { "content-type": "text/html" }, "<p>PKCE S256 required</p>");
            const fields = ["client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method"]
                .map((k) => "<input type=\"hidden\" name=\"" + k + "\" value=\"" + esc(q[k] || "") + "\">").join("");
            return send(res, 200, { "content-type": "text/html; charset=utf-8" }, "<!doctype html><html><head><meta charset=\"utf-8\">" +
                "<meta name=\"viewport\" content=\"width=device-width\"><title>Fake Provider</title>" +
                "<style>body{font-family:sans-serif;margin:0;background:#f4f6fb;color:#222}h1{background:#2d5bd0;color:#fff;margin:0;padding:16px;font-size:20px}" +
                "p{margin:16px}button{font-size:16px;padding:10px 18px;margin:0 0 0 16px;border-radius:6px;border:0}#allow{background:#2d5bd0;color:#fff}</style></head><body>" +
                "<h1>Fake Provider</h1><p>Phoenix Test would like to read your files (" + esc(q.scope || "") + ").</p>" +
                "<form method=\"post\" action=\"/authorize\">" + fields +
                "<button id=\"allow\" name=\"decision\" value=\"allow\" type=\"submit\">Allow</button>" +
                "<button id=\"deny\" name=\"decision\" value=\"deny\" type=\"submit\">Deny</button></form></body></html>");
        }
        if (u.pathname === "/authorize" && req.method === "POST") {
            const b = await body(req);
            if (b.client_id !== clientId || !redirectOk(b.redirect_uri)) return json(res, 400, { error: "invalid_client" });
            const sep = b.redirect_uri.indexOf("?") < 0 ? "?" : "&";
            if (b.decision !== "allow")
                return send(res, 302, { location: b.redirect_uri + sep + "error=access_denied&state=" + encodeURIComponent(b.state || "") });
            const code = "code-" + b64url(crypto.randomBytes(12));
            codes[code] = { redirectUri: b.redirect_uri, challenge: b.code_challenge, scope: b.scope };
            return send(res, 302, { location: b.redirect_uri + sep + "code=" + code + "&state=" + encodeURIComponent(b.state || "") });
        }
        if (u.pathname === "/token" && req.method === "POST") {
            const b = await body(req);
            st.tokenRequests.push(b);
            if (b.client_id !== clientId) return json(res, 401, { error: "invalid_client" });
            if (b.grant_type === "authorization_code") {
                const c = codes[b.code];
                delete codes[b.code];
                if (!c || c.redirectUri !== b.redirect_uri) return json(res, 400, { error: "invalid_grant" });
                const challenge = b64url(crypto.createHash("sha256").update(String(b.code_verifier || "")).digest());
                if (challenge !== c.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
                return json(res, 200, issue(c.scope));
            }
            if (b.grant_type === "refresh_token") {
                const r = refresh[b.refresh_token];
                if (!r || !r.live) return json(res, 400, { error: "invalid_grant" });
                r.live = false;
                st.refreshed++;
                return json(res, 200, issue(r.scope));
            }
            return json(res, 400, { error: "unsupported_grant_type" });
        }
        if (u.pathname === "/revoke" && req.method === "POST") {
            const b = await body(req);
            if (tokens[b.token]) tokens[b.token].live = false;
            if (refresh[b.token]) refresh[b.token].live = false;
            st.revoked.push(b.token);
            return send(res, 200, {}, "");
        }
        if (u.pathname === "/me") {
            const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
            if (!m || !tokens[m[1]] || !tokens[m[1]].live) return json(res, 401, { error: "invalid_token" });
            return json(res, 200, { name: "Phoenix Tester" });
        }
        send(res, 404, {}, "not found");
    }

    p.start = (port) => new Promise((resolve) => {
        server = http.createServer((req, res) => { handle(req, res).catch((e) => send(res, 500, {}, String(e))); });
        server.listen(port || 0, "127.0.0.1", () => {
            p.base = "http://127.0.0.1:" + server.address().port;
            p.authorizationEndpoint = p.base + "/authorize";
            p.tokenEndpoint = p.base + "/token";
            p.revocationEndpoint = p.base + "/revoke";
            resolve(p);
        });
    });
    p.stop = () => new Promise((resolve) => { if (server.closeAllConnections) server.closeAllConnections(); server.close(() => resolve()); });
    p.state = () => st;
    p.tokenLive = (t) => !!(tokens[t] && tokens[t].live);
    p.dropRefreshTokens = () => { Object.keys(refresh).forEach((k) => { refresh[k].live = false; }); };
    return p;
}

module.exports = { createFakeProvider };
