// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Providers whose sign-in needs Phoenix's app registered with them (an OAuth
// client id: docs/DEVELOPER-APPS.md), and the REST calls of a connector,
// written once for every such connector (the drives showed the pattern:
// apps/connectors/drives/service/connector.js clientOf, notAvailable,
// signIn):
//
//   registeredClient(ctx, file, provider, defaults)
//       the provider's registration from the image's setting
//       /etc/palm/<file> ({"<provider>": {"clientId": ..., ...}}), over the
//       connector's defaults (endpoints, scope); null without a client id.
//       Endpoint addresses in the setting (a test server's) may be reached.
//   notAvailable(name)
//       the error a sign-in page shows instead of Sign In:
//       "<name> is not available in this build", errorCode NOT_AVAILABLE
//   viaRelay(ctx, client)
//       the registration through Phoenix's token relay, for providers whose
//       token exchange needs the client secret; null without one
//   oauthSignIn(ctx, client, {accountId?})
//       the provider's page in the system's sign-in sheet through
//       org.webosphoenix.service.oauth (authorization code with PKCE) ->
//       the key the OAuth service keeps the tokens under; signing an
//       account in again forgets its old key
//   restApi(ctx, {base, token?, headers?, describe?})
//       get / post / patch / put / del of JSON at base, with the token as a
//       Bearer; an answer of 400 or more throws an error with its status
//       (401: 401_UNAUTHORIZED, which puts the warning on the account) and
//       the provider's own explanation (describe(body))

import type { BaseContext, Json } from "./types";

const OAUTH = "luna://org.webosphoenix.service.oauth/";

export interface RegisteredClient {
    clientId: string;
    clientSecret?: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint?: string;
    scope?: string;
    redirectUri?: string;
    /** More parameters of the authorization request (prompt, access_type, ...). */
    params?: Record<string, string>;
    [k: string]: Json;
}

function fail(message: string, errorCode: string, status?: number): Error {
    const e = new Error(message) as Error & { errorCode: string; status?: number };
    e.errorCode = errorCode;
    if (status) e.status = status;
    return e;
}

/** The provider's registration in /etc/palm/<file>, or null (not registered in this build). */
export async function registeredClient(ctx: BaseContext, file: string, provider: string, defaults: Record<string, Json>): Promise<RegisteredClient | null> {
    const all = await ctx.systemConfig(file);
    const c = all && all[provider];
    if (!c || typeof c.clientId !== "string" || !c.clientId) return null;
    const out = Object.assign({}, defaults, c) as RegisteredClient;
    // A test server's addresses (the setting's own) may be reached.
    Object.keys(c).forEach((k) => {
        if (typeof c[k] === "string" && /^https?:\/\//.test(c[k]) && k !== "redirectUri") {
            try { ctx.http.allowHost(new URL(c[k]).host); } catch (e) { /* not an address */ }
        }
    });
    return out;
}

/**
 * "<what> is not available in this build" (errorCode NOT_AVAILABLE):
 * Phoenix's app is not registered with the provider (name) here. what: the
 * provider's name, or what needs it ("Sign In with Todoist").
 */
export function notAvailable(name: string, what?: string): Error {
    return fail((what || name) + " is not available in this build: Phoenix's app is not registered with " + name +
                " here (docs/DEVELOPER-APPS.md)", "NOT_AVAILABLE");
}

async function lunaOk(ctx: BaseContext, uri: string, params: Json): Promise<Json> {
    const r = await ctx.luna.call(uri, params);
    if (r && r.returnValue === false) throw fail(r.errorText || uri + " failed", String(r.errorCode || "UNKNOWN_ERROR"));
    return r;
}

/**
 * A registration whose client secret stays with Phoenix's token relay
 * (docs/PLATFORM.md 6.5.4, OPEN-QUESTIONS Q49: Slack, LinkedIn, Zoom): the
 * setting names it ({"relay": "https://.../v1/oauth-broker/<provider>"});
 * the sign-in starts at its /authorize and redeems the handle at its
 * /redeem, and the OAuth service refreshes through it (its `broker`
 * option). Null when the setting names no relay or the OAuth service has
 * no broker (not in this build).
 */
export async function viaRelay(ctx: BaseContext, client: RegisteredClient | null): Promise<RegisteredClient | null> {
    if (!client || typeof client.relay !== "string" || !/^https?:\/\//.test(client.relay)) return null;
    try {
        const r = await ctx.luna.call(OAUTH + "broker", { probe: true });
        if (!r || r.returnValue === false) return null;
    } catch (e) {
        return null;
    }
    const relay = client.relay.replace(/\/+$/, "");
    const out = Object.assign({}, client, { authorizationEndpoint: relay + "/authorize", tokenEndpoint: relay + "/redeem", broker: relay }) as RegisteredClient;
    delete out.clientSecret;
    return out;
}

/** The provider's sign-in page in the sheet (OAuth with PKCE) -> the OAuth service's key of the tokens. */
export async function oauthSignIn(ctx: BaseContext, client: RegisteredClient, opts?: { accountId?: string; scope?: string }): Promise<string> {
    const r = await lunaOk(ctx, OAUTH + "redirectUri", {});
    const req: Json = {
        authorizationEndpoint: client.authorizationEndpoint, tokenEndpoint: client.tokenEndpoint, clientId: client.clientId,
        scope: (opts && opts.scope) || client.scope || "", redirectUri: client.redirectUri || r.redirectUri
    };
    if (typeof client.broker === "string") req.broker = client.broker;
    if (client.clientSecret) req.clientSecret = client.clientSecret;
    if (client.revocationEndpoint) req.revocationEndpoint = client.revocationEndpoint;
    if (client.params) req.params = client.params;
    const auth = await lunaOk(ctx, OAUTH + "authorize", req);
    return String(auth.keyId);
}

/** Signing an account in again: its old key (credentials.common.oauthKey) is forgotten. */
export async function forgetOldKey(ctx: BaseContext, accountId: string | undefined, newKey: string): Promise<void> {
    if (!accountId) return;
    try {
        const r = await lunaOk(ctx, "luna://com.palm.service.accounts/readCredentials", { accountId, name: "common" });
        const k = r.credentials && r.credentials.oauthKey;
        if (k && k !== newKey) await ctx.oauth.forget(k);
    } catch (e) { /* no old key */ }
}

export interface RestOptions {
    /** The API's address; paths are appended to it (a full address is used as it is). */
    base: string;
    /** The access token, asked for before each call (refreshed by the OAuth service). */
    token?: () => Promise<string>;
    /** Headers on every call. */
    headers?: Record<string, string>;
    /** The provider's explanation of an error from its body. */
    describe?: (body: Json) => string;
}

export interface RestApi {
    get(path: string, query?: Record<string, Json>): Promise<Json>;
    post(path: string, body?: Json, headers?: Record<string, string>): Promise<Json>;
    patch(path: string, body?: Json, headers?: Record<string, string>): Promise<Json>;
    put(path: string, body?: Json, headers?: Record<string, string>): Promise<Json>;
    del(path: string, headers?: Record<string, string>): Promise<Json>;
    /** Any method; form: a form body (application/x-www-form-urlencoded) instead of JSON. */
    send(method: string, path: string, opts?: { body?: Json; form?: Record<string, Json>; headers?: Record<string, string>; query?: Record<string, Json>; raw?: boolean }): Promise<Json>;
    url(path: string, query?: Record<string, Json>): string;
}

function queryString(q?: Record<string, Json>): string {
    if (!q) return "";
    const parts: string[] = [];
    Object.keys(q).forEach((k) => {
        const v = q[k];
        if (v === undefined || v === null || v === "") return;
        (Array.isArray(v) ? v : [v]).forEach((x) => parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(x))));
    });
    return parts.length ? parts.join("&") : "";
}

export function formBody(o: Record<string, Json>): string {
    return queryString(o);
}

/** JSON calls to a provider's REST API (docs above). */
export function restApi(ctx: BaseContext, opts: RestOptions): RestApi {
    const url = (path: string, query?: Record<string, Json>): string => {
        const u = /^https?:\/\//.test(path) ? path : !path ? opts.base : opts.base.replace(/\/+$/, "") + (path.charAt(0) === "/" ? "" : "/") + path;
        const q = queryString(query);
        return q ? u + (u.indexOf("?") < 0 ? "?" : "&") + q : u;
    };
    async function send(method: string, path: string, o?: { body?: Json; form?: Record<string, Json>; headers?: Record<string, string>; query?: Record<string, Json>; raw?: boolean }): Promise<Json> {
        o = o || {};
        const headers: Record<string, string> = Object.assign({ Accept: "application/json" }, opts.headers || {}, o.headers || {});
        if (opts.token) headers.Authorization = "Bearer " + await opts.token();
        const req: Json = { method, url: url(path, o.query), headers };
        if (o.form) { req.body = queryString(o.form); headers["Content-Type"] = "application/x-www-form-urlencoded"; }
        else if (o.body !== undefined) { req.body = typeof o.body === "string" ? o.body : JSON.stringify(o.body); if (!headers["Content-Type"]) headers["Content-Type"] = "application/json"; }
        const res = await ctx.http.request(req);
        let body: Json = null;
        try { body = res.body ? JSON.parse(res.body) : null; } catch (e) { body = o.raw ? res.body : null; }
        if (res.status >= 400) {
            let detail = "";
            try { detail = opts.describe ? opts.describe(body) || "" : ""; } catch (e) { detail = ""; }
            if (!detail && body) detail = typeof body.error === "string" ? body.error_description || body.error : (body.error && body.error.message) || body.message || "";
            throw fail((detail ? detail + " " : "") + "(HTTP " + res.status + ", " + method + " " + String(req.url).replace(/\?.*$/, "") + ")",
                       res.status === 401 ? "401_UNAUTHORIZED" : res.status === 403 ? "PERMISSION_DENIED" : res.status === 404 ? "NOT_FOUND" : "",
                       res.status);
        }
        return o.raw ? { status: res.status, headers: res.headers || {}, body } : body;
    }
    return {
        url,
        send,
        get: (path, query) => send("GET", path, { query }),
        post: (path, body, headers) => send("POST", path, { body, headers }),
        patch: (path, body, headers) => send("PATCH", path, { body, headers }),
        put: (path, body, headers) => send("PUT", path, { body, headers }),
        del: (path, headers) => send("DELETE", path, { headers })
    };
}
