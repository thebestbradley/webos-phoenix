// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A device in memory for a connector's tests (as the drives' drives.test.ts
// builds one): db8 and tempdb (@phoenix/synckit's memdb), the accounts
// service's records, the real OAuth service (services/oauth/oauthservice.js)
// whose sign-in sheet follows the fake provider's redirects, notifications
// and Messaging's putMessage recorded, and the connector's service made by
// the kit from its definition. addAccount does what
// com.palm.service.accounts does with a sign-in's answer.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as kit from "@phoenix/connector-kit";
import * as synckit from "@phoenix/synckit";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";

const require = createRequire(__filename);
const oauthLib = require("../../../services/oauth/oauthservice.js");
export const request = synckit.createRequest({ timeoutMs: 20000 });

export function template(dir: string, templateId: string): any {
    return JSON.parse(readFileSync(join(dir, "public", "accounts", templateId, templateId + ".json"), "utf8"));
}

export interface WorldOptions {
    /** The connector's package folder (apps/connectors/<name>). */
    dir: string;
    /** The definition (connector.js, loaded). */
    def: any;
    /** systemConfig(name) answers: {"todoist/clients.json": {...}}. */
    config?: Record<string, any>;
    /** More Luna handlers. */
    handlers?: Record<string, (p: any, uri: string) => any>;
    /** Kinds the connector extends (sub-kind -> parent), besides memdb's. */
    kindParents?: Record<string, string>;
    /** The device's files (sharing). */
    files?: Record<string, { bytes: Uint8Array; mimeType: string }>;
    now?: () => number;
}

export async function world(o: WorldOptions) {
    const parents = Object.assign({}, memdb.KIND_PARENTS, o.kindParents || {});
    const db = memdb.createMemDb(parents);
    const tempdb = memdb.createMemDb();
    const keys: Record<string, any> = {};
    const accounts: Record<string, any> = {};
    const credentials: Record<string, any> = {};
    const toasts: any[] = [];
    const sheets: string[] = [];
    const service = o.def.service;
    const oauth = oauthLib.createOAuthService({
        request,
        keystore: { get: async (k: string) => keys[k], put: async (k: string, v: any) => { keys[k] = v; }, del: async (k: string) => { delete keys[k]; } },
        crypto: { randomBytes: (n: number) => new Uint8Array(require("crypto").randomBytes(n)),
                  sha256: async (b: Uint8Array) => new Uint8Array(require("crypto").createHash("sha256").update(Buffer.from(b)).digest()) },
        redirectUri: "http://127.0.0.1:1/signed-in.html",
        // The browser sheet: the provider's page, its redirects followed, until the redirect address.
        sheet: async (url: string, prefix: string) => {
            sheets.push(url);
            let at = url;
            for (let i = 0; i < 5 && at.indexOf(prefix) !== 0; i++) {
                const r = await request({ method: "GET", url: at });
                if (!r.headers.location) throw new Error("no redirect from " + at + ": " + r.status + " " + String(r.body).slice(0, 200));
                at = new URL(r.headers.location, at).href;
            }
            return at;
        }
    });
    let methods: any = {};
    const handlers: Record<string, any> = Object.assign({
        "luna://org.webosphoenix.service.oauth/*": (p: any, uri: string) => (oauth as any)[uri.slice(uri.lastIndexOf("/") + 1)](p, service),
        "luna://com.palm.service.accounts/listAccounts": (p: any) => ({ returnValue: true,
            results: Object.values(accounts).filter((a: any) => !p || !p.templateId || a.templateId === p.templateId) }),
        "luna://com.webos.notification/createToast": (p: any) => { toasts.push(p); return { returnValue: true, toastId: "t" + toasts.length }; },
        "luna://org.webosports.service.messaging/putMessage": async (p: any) => {
            const r = await db.put([Object.assign({ conversations: ["thread-" + ((p.message.from && p.message.from.addr) || "x")] }, p.message)]);
            return { returnValue: true, threadids: ["thread-" + ((p.message.from && p.message.from.addr) || "x")], id: r[0].id };
        },
        ["luna://" + service + "/*"]: (p: any, uri: string) => methods[uri.slice(uri.lastIndexOf("/") + 1)](p)
    }, o.handlers || {});
    const bus = memdb.createFakeBus({ db, tempdb, accounts, credentials, handlers });
    const config = o.config || {};
    methods = kit.createConnectorService(o.def, {
        luna: bus, request, periodicSync: false, now: o.now,
        systemConfig: async (name: string) => (name in config ? config[name] : null),
        readFile: async (path: string) => {
            const f = o.files && o.files[path];
            if (!f) throw new Error("no file " + path);
            return f;
        },
        log: () => {}
    });
    async function addAccount(templateId: string, r: any, id?: string) {
        if (!r || r.returnValue !== true) throw new Error("sign-in failed: " + JSON.stringify(r));
        const accountId = id || "acct-" + templateId.replace(/^.*\./, "");
        const t = template(o.dir, templateId);
        accounts[accountId] = { _id: accountId, templateId: t.templateId, username: r.username, loc_name: t.loc_name, icon: t.icon,
                                capabilityProviders: t.capabilityProviders.map((c: any) => Object.assign({}, c)) };
        credentials[accountId] = r.credentials;
        const created = await methods.onCreate({ accountId, config: r.config });
        if (!created.returnValue) throw new Error("onCreate: " + JSON.stringify(created));
        return accountId;
    }
    async function enable(accountId: string, providerId: string, on = true) {
        const r = await methods.onEnabled({ accountId, capabilityProviderId: providerId, enabled: on });
        if (!r.returnValue) throw new Error("onEnabled: " + JSON.stringify(r));
    }
    async function sync(accountId: string, capability?: string) {
        const r = await methods.sync(Object.assign({ accountId }, capability ? { capability } : {}));
        return r;
    }
    const find = (kind: string, where?: any[]) => db.find({ from: kind, where: where || [] });
    return { methods, db, tempdb, bus, keys, accounts, credentials, toasts, sheets, addAccount, enable, sync, find, config };
}
