// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where a person without an account signs up (docs/SYNERGY-SDK.md,
// "Sign-up link"). A connector says it in its definition's `signUp`: a
// page of the service ("https://example.com/join"), or for a federated
// service a page to choose a server and/or servers to suggest:
//
//   signUp: "https://joinmastodon.org/servers"
//   signUp: {url?: "https://...", servers?: [{name: "example.social", url: "https://example.social/auth/sign_up"}]}
//
// phoenix-connector pack writes it into the account template as
// `signUp: {url?, servers?}` (templateSignUp), where the Accounts app's
// sign-in step shows "Don't have an account? Sign up" (the compat overlay's
// Accounts.SignUpLink). Every address is https (rule C16 of the package
// checks, also in server/marketplace/src/Connector.php).

import type { Json } from "./types";

export interface SignUp { url?: string; servers?: { name: string; url: string }[] }

const HTTPS = /^https:\/\/[^\s/?#]+[^\s]*$/i;

export function isHttps(v: unknown): boolean {
    return typeof v === "string" && v.length <= 500 && HTTPS.test(v);
}

/** The template's signUp from a definition's (a string is the page's address); null without one. */
export function templateSignUp(v: unknown): SignUp | null {
    if (v === undefined || v === null) return null;
    if (typeof v === "string") return { url: v };
    const o = v as Json;
    const out: SignUp = {};
    if (o.url !== undefined) out.url = o.url;
    if (o.servers !== undefined) out.servers = o.servers;
    return out;
}

/** Problems with a signUp (the definition's or a template's). */
export function signUpProblems(v: unknown): string[] {
    if (v === undefined) return [];
    const s = typeof v === "string" ? { url: v } : v as Json;
    if (!s || typeof s !== "object" || Array.isArray(s)) return ["signUp: an https:// address, or {url?, servers?}"];
    const out: string[] = [];
    if (s.url === undefined && s.servers === undefined) out.push("signUp: a url or servers");
    if (s.url !== undefined && !isHttps(s.url)) out.push("signUp.url: an https:// address");
    if (s.servers !== undefined) {
        if (!Array.isArray(s.servers) || !s.servers.length || s.servers.length > 10) out.push("signUp.servers: a list of 1 to 10 {name, url}");
        else s.servers.forEach((x: Json, i: number) => {
            if (!x || typeof x.name !== "string" || !x.name.trim() || x.name.length > 80 || !isHttps(x.url))
                out.push("signUp.servers[" + i + "]: {name, url: an https:// address}");
        });
    }
    Object.keys(s).forEach((k) => { if (k !== "url" && k !== "servers") out.push("signUp." + k + ": not a field of signUp (url, servers)"); });
    return out;
}
