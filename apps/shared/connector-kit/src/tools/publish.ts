// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-connector publish: a connector to a Phoenix catalog through its
// developer API (server/marketplace, POST /api/apps/packages with the .ipk as
// the body; docs/SYNERGY-SDK.md "Publishing"). A folder is validated and
// packed first (pack); an .ipk is validated. The catalog runs the same checks
// and reads what Connections shows of each account type from catalog.json.
//
// --local is the catalog on this computer (server/marketplace/bin/serve.sh,
// which the simulator starts: http://127.0.0.1:8088/), a development catalog
// that approves and publishes an upload at once. Its developer token is the
// checkout's server/marketplace/data/developer.token (serve.sh makes it;
// MARKETPLACE_DATA elsewhere); a local catalog without one gets a developer
// account registered here, its token kept in ~/.config/phoenix-connector.
// Any other catalog needs --token (or PHOENIX_CATALOG_TOKEN), and a human
// reviews the upload there.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { checkIpk, pack, readFolder } from "./package";
import type { Files } from "./checks";

export const LOCAL_CATALOG = "http://127.0.0.1:8088/";

const fs = () => require("fs");
const path = () => require("path");
const os = () => require("os");

export interface PublishOptions {
    /** The catalog's address (its root, or its /v1/). */
    catalog: string;
    token?: string;
    namespaces?: string[];
    /** false: the kit is not packed into service/node_modules (tests). */
    vendor?: boolean;
    /** Where a local catalog's developer token is (default: the checkout's server/marketplace/data/developer.token). */
    tokenFile?: string;
    /** Where tokens registered here are kept (default: ~/.config/phoenix-connector/tokens.json). */
    tokenCache?: string;
    log?(s: string): void;
}

export interface PublishResult {
    appId: string;
    version: string;
    /** "approved" (a development catalog: published at once) or "pending" (waiting for review). */
    state: string;
    /** The catalog's new build, when it published. */
    build: number | null;
    templates: string[];
    catalog: string;
}

/** A catalog's root address: http://127.0.0.1:8088/v1/ -> http://127.0.0.1:8088/. */
export function catalogRoot(url: string): string {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/v1\/?$/, "/").replace(/\/*$/, "/");
}

export function isLocal(url: string): boolean {
    return /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/.test(new URL(url).hostname);
}

/** What is wrong with a connector's catalog.json (Catalog::connectorTypes has the full rules), or "". */
export function catalogDetailsProblem(files: Files, templates: string[]): string {
    const bytes = files["catalog.json"];
    if (!bytes) return "catalog.json is missing: it says what the Marketplace's Connections view shows of each account type (docs/SYNERGY-SDK.md)";
    let meta: any;
    try { meta = JSON.parse(Buffer.from(bytes).toString("utf8").replace(/^﻿/, "")); } catch (e) { return "catalog.json is not valid JSON"; }
    const list = meta && Array.isArray(meta.accountTypes) ? meta.accountTypes : null;
    if (!list) return "catalog.json: {\"accountTypes\": [{templateId, summary, auth, server, privacy, ...}]}";
    const named = list.map((t: any) => t && t.templateId);
    const missing = templates.filter((t) => named.indexOf(t) < 0);
    return missing.length ? "catalog.json: nothing for the template " + missing.join(", ") : "";
}

/** The checkout this kit is in (apps/shared/connector-kit -> its top). */
function checkout(): string {
    return path().resolve(__dirname, "..", "..", "..", "..", "..");
}

function readToken(file: string): string {
    try { return String(fs().readFileSync(file, "utf8")).trim(); } catch (e) { return ""; }
}

async function api(root: string, method: string, p: string, body: unknown, token?: string): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = "Bearer " + token;
    let data: any;
    if (body instanceof Uint8Array) { headers["Content-Type"] = "application/octet-stream"; data = body; }
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; data = JSON.stringify(body); }
    let res: any;
    try { res = await (globalThis as any).fetch(root + p.replace(/^\//, ""), { method, headers, body: data }); }
    catch (e) { throw new Error("could not reach the catalog at " + root + ((e as any).cause ? " (" + (e as any).cause.message + ")" : "")); }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch (e) { json = { error: text.slice(0, 200) }; }
    return { status: res.status, json };
}

/** A developer token for a local catalog: its own (data/developer.token), else one registered here and kept. */
async function localToken(root: string, opts: PublishOptions, again: boolean): Promise<string> {
    const p = path(), f = fs();
    const own = opts.tokenFile || p.join(process.env.MARKETPLACE_DATA || p.join(checkout(), "server", "marketplace", "data"), "developer.token");
    const fromCatalog = readToken(own);
    if (fromCatalog && !again) return fromCatalog;
    const cacheFile = opts.tokenCache || p.join(os().homedir(), ".config", "phoenix-connector", "tokens.json");
    let cache: Record<string, string> = {};
    try { cache = JSON.parse(f.readFileSync(cacheFile, "utf8")); } catch (e) { cache = {}; }
    if (cache[root] && !again) return cache[root];
    const r = await api(root, "POST", "api/accounts", { name: "Local developer", email: "developer@localhost.localdomain", role: "developer" });
    if (r.status !== 200 || !r.json.token) throw new Error("the catalog at " + root + " did not register a developer: " + (r.json.error || "HTTP " + r.status));
    cache[root] = r.json.token;
    f.mkdirSync(p.dirname(cacheFile), { recursive: true });
    f.writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + "\n", { mode: 0o600 });
    return r.json.token;
}

export async function publish(target: string, opts: PublishOptions): Promise<PublishResult> {
    const p = path(), f = fs();
    const log = opts.log || (() => {});
    const root = catalogRoot(opts.catalog);
    let bytes: Uint8Array;
    let check;
    if (/\.ipk$/i.test(target)) {
        bytes = new Uint8Array(f.readFileSync(target));
        check = checkIpk(bytes, { namespaces: opts.namespaces });
        if (check.errors.length) throw new Error("The package does not pass the checks:\n  " + check.errors.join("\n  "));
    } else {
        const dir = p.resolve(target);
        const files = readFolder(dir);
        const out = f.mkdtempSync(p.join(os().tmpdir(), "phoenix-connector-"));
        try {
            const r = pack(dir, out, { namespaces: opts.namespaces, vendor: opts.vendor });
            check = r.check;
            const problem = catalogDetailsProblem(files, check.templates);
            if (problem) throw new Error(problem);
            r.check.warnings.forEach((w) => log("warning " + w));
            log("Packed " + p.basename(r.file) + " (" + Math.round(r.size / 1024) + " KB)");
            bytes = new Uint8Array(f.readFileSync(r.file));
        } finally {
            f.rmSync(out, { recursive: true, force: true });
        }
    }
    const local = isLocal(root);
    let token = opts.token || process.env.PHOENIX_CATALOG_TOKEN || "";
    if (!token && !local) throw new Error("a developer token for " + root + ": --token TOKEN or PHOENIX_CATALOG_TOKEN");
    if (!token) token = await localToken(root, opts, false);
    let r = await api(root, "POST", "api/apps/packages", bytes, token);
    // A local catalog set up again since the token was kept: a new developer account.
    if (r.status === 401 && local && !opts.token && !process.env.PHOENIX_CATALOG_TOKEN) {
        token = await localToken(root, opts, true);
        r = await api(root, "POST", "api/apps/packages", bytes, token);
    }
    if (r.status !== 200) throw new Error("the catalog at " + root + " refused it: " + (r.json && r.json.error || "HTTP " + r.status));
    return {
        appId: r.json.app.id, version: r.json.release.version, state: r.json.release.state,
        build: r.json.publish ? r.json.publish.build : null, templates: check.templates, catalog: root
    };
}
