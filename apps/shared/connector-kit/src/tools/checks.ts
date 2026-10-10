// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The connector profile checks (docs/SYNERGY-CONNECTORS.md 2.2): what the
// Marketplace checks in a connector package before a human reviews it.
// server/marketplace/src/Connector.php runs the same rules on the server;
// both are tested on the same cases (server/marketplace/tests/connector-cases.json),
// so `phoenix-connector validate` tells a developer what the Marketplace
// will say. Each problem starts with its rule's code:
//
//   C1  appinfo.json: valid, a reverse-DNS id, type "web", a version
//   C2  at least one account template, public/accounts/<dir>/<dir>.json
//   C3  the template follows the accounts service's schema
//       (third_party/app-services/com.palm.service.accounts/schemas/template.json)
//   C4  templateId is its folder's name
//   C5  templateId, capability provider ids, the service and own kinds are
//       in the developer's namespace (the app id's first two labels, or
//       those given)
//   C6  the template's icons are in the package
//   C7  the validator is the package's own service; a customUI page is
//       the package's own app and file
//   C8  capability providers: capability names, implementation and every
//       callback on the package's own service, dbkinds the package's kinds
//   C9  one service in service/: package.json with its name, sysbus files
//       (.service, .role.json, .api.json), a role that calls only the
//       services a connector may (3.2 rule 10)
//   C10 kinds: owned by the service; a capability's kinds extend its
//       generic kind (3.2 rule 4)
//   C11 db8 permissions only on the package's own kinds (gap 4)
//   C12 no native code (ELF, Mach-O, PE; .node, .so, .dylib, .dll, .exe)
//   C13 the .ipk: files only under its app, no links, no scripts, 64 MB at
//       most, control file and appinfo.json agreeing
//
// files: the package's files by path relative to the app's folder.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CheckResult {
    errors: string[];
    warnings: string[];
    appId: string;
    version: string;
    service: string;
    templates: string[];
    kinds: string[];
}

export type Files = Record<string, Uint8Array>;

const ID = /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/;
const KIND_ID = /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+:\d+$/;

/** The generic kinds a capability's own kinds extend (3.2 rule 4). */
export const GENERIC_KINDS: Record<string, string[]> = {
    CONTACTS: ["com.palm.contact:1"],
    CALENDAR: ["com.palm.calendar:1", "com.palm.calendarevent:1"],
    TASKS: ["com.palm.tasklist:1", "com.palm.task:1"],
    MEMOS: ["com.palm.note:1"],
    MAIL: ["com.palm.mail.account:1", "com.palm.folder:1", "com.palm.email:1"],
    MESSAGING: ["com.palm.message:1", "com.palm.immessage:1", "com.palm.imbuddystatus:1", "com.palm.imloginstate:1"],
    IM: ["com.palm.message:1", "com.palm.immessage:1", "com.palm.imbuddystatus:1", "com.palm.imloginstate:1"]
};

/** The services a connector's service may call (3.2 rule 10, and what SOCIAL and MESSAGING connectors need). */
export const ALLOWED_OUTBOUND = ["com.palm.db", "com.palm.tempdb", "com.palm.activitymanager", "com.palm.service.accounts",
                                 "org.webosphoenix.service.oauth", "org.webosphoenix.service.keystore", "org.webosphoenix.service.push",
                                 "com.webos.notification", "org.webosports.service.messaging"];

const CALLBACKS = ["onCreate", "onEnabled", "onDelete", "onCredentialsChanged", "sync"];
const SYSBUS_REQUIRED = [".service", ".role.json", ".api.json"];

function text(b: Uint8Array): string {
    let s = "";
    try { s = new TextDecoder().decode(b); } catch (e) { s = ""; }
    return s.replace(/^﻿/, "");
}

function json(files: Files, path: string): { ok: boolean; value: any } {
    if (!files[path]) return { ok: false, value: null };
    try { return { ok: true, value: JSON.parse(text(files[path])) }; } catch (e) { return { ok: false, value: null }; }
}

function isNative(path: string, b: Uint8Array): boolean {
    if (/\.(node|so|dylib|dll|exe)$/i.test(path) || /\.so\.\d/.test(path)) return true;
    if (b.length >= 4 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return true;      // ELF
    if (b.length >= 4) {
        const m = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
        if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].indexOf(m) >= 0) return true;    // Mach-O
    }
    // PE ("MZ"): a file without an extension, or a program's.
    if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a && (/\.(bin|exe|dll|sys)$/i.test(path) || !/\.[A-Za-z0-9]+$/.test(path))) return true;
    return false;
}

function serviceOf(address: unknown): string | null {
    const m = /^(?:palm|luna):\/\/([^/]+)\/?/.exec(String(address || ""));
    return m ? m[1] : null;
}

function inNamespace(id: string, namespaces: string[]): boolean {
    return namespaces.some((ns) => id === ns || id.indexOf(ns + ".") === 0);
}

/** The generic kind a legacy-style name extends: "com.palm.contact.dav:1" -> "com.palm.contact:1". */
function genericPrefixOf(kind: string): string | null {
    const all = Object.keys(GENERIC_KINDS).reduce((a, k) => a.concat(GENERIC_KINDS[k]), [] as string[]);
    for (const g of all) {
        const base = g.replace(/:\d+$/, "");
        if (kind.indexOf(base + ".") === 0) return g;
    }
    return null;
}

export function checkConnector(files: Files, options?: { namespaces?: string[] }): CheckResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const out: CheckResult = { errors, warnings, appId: "", version: "", service: "", templates: [], kinds: [] };

    // C1 appinfo.json
    const info = json(files, "appinfo.json");
    if (!info.ok || !info.value || typeof info.value !== "object") {
        errors.push("C1 appinfo.json is missing or not valid JSON");
        return out;
    }
    const appId = String(info.value.id || "");
    out.appId = appId;
    out.version = String(info.value.version || "");
    if (!ID.test(appId)) errors.push("C1 appinfo.json: not a valid app id: " + appId);
    if ((info.value.type || "web") !== "web") errors.push("C1 appinfo.json: a connector's app is a web app (type \"web\")");
    if (!out.version) errors.push("C1 appinfo.json: no version");
    if (!(info.value.phoenix && info.value.phoenix.hidden)) warnings.push("C1 appinfo.json: a connector's app is usually hidden (\"phoenix\": {\"hidden\": true})");
    const namespaces = (options && options.namespaces && options.namespaces.length) ? options.namespaces : [appId.split(".").slice(0, 2).join(".")];

    // C12 native code
    Object.keys(files).forEach((p) => { if (isNative(p, files[p])) errors.push("C12 native code is not allowed: " + p); });

    // C9 the service
    const pkg = json(files, "service/package.json");
    const service = pkg.ok && pkg.value ? String(pkg.value.name || "") : "";
    out.service = service;
    if (!pkg.ok) errors.push("C9 service/package.json is missing or not valid JSON");
    else if (!ID.test(service)) errors.push("C9 service/package.json: name must be the Luna service name");
    else {
        if (!inNamespace(service, namespaces)) errors.push("C5 the service " + service + " is not in the namespace " + namespaces.join(", "));
        SYSBUS_REQUIRED.forEach((suffix) => {
            if (!files["service/sysbus/" + service + suffix]) errors.push("C9 service/sysbus/" + service + suffix + " is missing");
        });
        const role = json(files, "service/sysbus/" + service + ".role.json");
        if (role.ok && role.value) {
            const names: string[] = role.value.allowedNames || [];
            if (names.length !== 1 || names[0] !== service) errors.push("C9 the role's allowedNames must be [\"" + service + "\"]");
            (role.value.permissions || []).forEach((perm: any) => {
                (perm.outbound || []).forEach((o: string) => {
                    if (o !== service && ALLOWED_OUTBOUND.indexOf(o) < 0) errors.push("C9 the service may not call " + o);
                });
            });
        } else if (files["service/sysbus/" + service + ".role.json"]) {
            errors.push("C9 the role file is not valid JSON");
        }
    }
    const extraServices = Object.keys(files).filter((p) => /^service\/sysbus\/.+\.role\.json$/.test(p) && p !== "service/sysbus/" + service + ".role.json");
    if (extraServices.length) errors.push("C9 one service per connector: " + extraServices.join(", "));

    // C10 kinds
    const kinds: Record<string, any> = {};
    Object.keys(files).sort().filter((p) => /^configuration\/db\/kinds\/[^/]+$/.test(p)).forEach((p) => {
        const k = json(files, p);
        if (!k.ok || !k.value || !KIND_ID.test(String(k.value.id || ""))) { errors.push("C10 " + p + ": not a db8 kind"); return; }
        const id = String(k.value.id);
        kinds[id] = k.value;
        out.kinds.push(id);
        if (service && k.value.owner !== service) errors.push("C10 the kind " + id + " must be owned by " + (service || "the service"));
        const generic = genericPrefixOf(id);
        const ext: string[] = Array.isArray(k.value.extends) ? k.value.extends : k.value.extends ? [k.value.extends] : [];
        if (generic) {
            if (ext.indexOf(generic) < 0) errors.push("C10 the kind " + id + " must extend " + generic);
        } else if (!inNamespace(id, namespaces)) {
            errors.push("C5 the kind " + id + " is not in the namespace " + namespaces.join(", "));
        }
    });

    // C11 permissions
    Object.keys(files).sort().filter((p) => /^configuration\/db\/permissions\/[^/]+$/.test(p)).forEach((p) => {
        const perm = json(files, p);
        const list = perm.ok ? (Array.isArray(perm.value) ? perm.value : [perm.value]) : null;
        if (!list) { errors.push("C11 " + p + ": not valid JSON"); return; }
        list.forEach((e: any) => {
            if (!e || e.type !== "db.kind" || !kinds[e.object])
                errors.push("C11 " + p + ": a permission on " + (e && e.object) + ", not one of the package's kinds");
        });
    });

    // C2 - C8 templates
    const templateFiles = Object.keys(files).sort().filter((p) => /^public\/accounts\/[^/]+\/[^/]+\.json$/.test(p));
    const ownTemplates = templateFiles.filter((p) => { const m = /^public\/accounts\/([^/]+)\/([^/]+)\.json$/.exec(p) as RegExpExecArray; return m[1] === m[2]; });
    if (!ownTemplates.length) errors.push("C2 no account template (public/accounts/<templateId>/<templateId>.json)");
    templateFiles.forEach((p) => {
        const m = /^public\/accounts\/([^/]+)\/([^/]+)\.json$/.exec(p) as RegExpExecArray;
        const dir = "public/accounts/" + m[1] + "/";
        if (m[1] !== m[2]) {
            warnings.push("C4 " + p + " is not read: a template is public/accounts/<id>/<id>.json");
            return;
        }
        const t = json(files, p);
        if (!t.ok) { errors.push("C3 " + p + ": not valid JSON"); return; }
        (Array.isArray(t.value) ? t.value : [t.value]).forEach((tpl: any) => checkTemplate(tpl, dir, m[1]));
    });

    function checkTemplate(tpl: any, dir: string, folder: string) {
        if (!tpl || typeof tpl !== "object" || Array.isArray(tpl)) { errors.push("C3 " + dir + ": a template is an object"); return; }
        const id = tpl.templateId;
        if (typeof id !== "string") { errors.push("C3 " + dir + ": templateId must be a string"); return; }
        out.templates.push(id);
        if (id !== folder) errors.push("C4 the template " + id + " is in the folder " + folder);
        if (!inNamespace(id, namespaces)) errors.push("C5 the template " + id + " is not in the namespace " + namespaces.join(", "));
        if (typeof tpl.loc_name !== "string") errors.push("C3 " + id + ": loc_name must be a string");
        const icons = [] as string[];
        function iconObject(o: any, where: string) {
            if (o === undefined) return;
            if (!o || typeof o !== "object" || Array.isArray(o)) { errors.push("C3 " + where + ": icon must be an object"); return; }
            ["loc_32x32", "loc_48x48"].forEach((k) => {
                if (o[k] === undefined) return;
                if (typeof o[k] !== "string") errors.push("C3 " + where + ": icon." + k + " must be a string");
                else icons.push(o[k]);
            });
        }
        iconObject(tpl.icon, id);
        if (tpl.validator !== undefined && typeof tpl.validator !== "string" && (typeof tpl.validator !== "object" || tpl.validator === null || Array.isArray(tpl.validator)))
            errors.push("C3 " + id + ": validator must be a string or an object");
        if (!Array.isArray(tpl.capabilityProviders)) { errors.push("C3 " + id + ": capabilityProviders must be an array"); return; }
        tpl.capabilityProviders.forEach((cp: any, i: number) => {
            const where = id + " capabilityProviders[" + i + "]";
            if (!cp || typeof cp !== "object") { errors.push("C3 " + where + ": an object"); return; }
            if (typeof cp.capability !== "string") errors.push("C3 " + where + ": capability must be a string");
            if (typeof cp.id !== "string") errors.push("C3 " + where + ": id must be a string");
            if (cp.loc_name !== undefined && typeof cp.loc_name !== "string") errors.push("C3 " + where + ": loc_name must be a string");
            if (cp.implementation !== undefined && typeof cp.implementation !== "string") errors.push("C3 " + where + ": implementation must be a string");
            iconObject(cp.icon, where);
        });

        // C6 icons
        icons.forEach((rel) => {
            if (!files[dir + rel]) errors.push("C6 " + id + ": the icon " + rel + " is not in the package");
            else if (/\.png$/.test(rel) && !files[dir + rel.replace(/\.png$/, "@2x.png")]) warnings.push("C6 " + id + ": no @2x variant of " + rel);
        });

        // C7 validator
        const v = tpl.validator;
        const address = typeof v === "string" ? v : v && v.address;
        if (address !== undefined && serviceOf(address) !== service) errors.push("C7 " + id + ": the validator must be on " + (service || "the package's service"));
        if (v && typeof v === "object" && v.customUI) {
            if (v.customUI.appId !== appId) errors.push("C7 " + id + ": the sign-in page (customUI) must be the package's own app, " + appId);
            else if (!files[String(v.customUI.name || "")]) errors.push("C7 " + id + ": the sign-in page " + v.customUI.name + " is not in the app");
        }

        // C8 capability providers
        const seen: Record<string, boolean> = {};
        tpl.capabilityProviders.forEach((cp: any) => {
            if (!cp || typeof cp !== "object") return;
            const where = id + " " + (cp.id || "?");
            if (typeof cp.capability === "string" && !/^[A-Z][A-Z0-9_.]*$/.test(cp.capability))
                errors.push("C8 " + where + ": capability names are upper case (CONTACTS, CALENDAR, ...)");
            if (typeof cp.id === "string") {
                if (seen[cp.id]) errors.push("C8 " + where + ": listed twice");
                seen[cp.id] = true;
                if (!inNamespace(cp.id, namespaces)) errors.push("C5 the capability provider " + cp.id + " is not in the namespace " + namespaces.join(", "));
            }
            if (serviceOf(cp.implementation) !== service) errors.push("C8 " + where + ": implementation must be palm://" + (service || "<the service>") + "/");
            CALLBACKS.forEach((cb) => {
                if (cp[cb] !== undefined && serviceOf(cp[cb]) !== service) errors.push("C8 " + where + ": " + cb + " must be on " + (service || "the package's service"));
            });
            const dbkinds = cp.dbkinds && typeof cp.dbkinds === "object" ? cp.dbkinds : {};
            const generics = GENERIC_KINDS[cp.capability] || null;
            Object.keys(dbkinds).forEach((k) => {
                const kind = dbkinds[k];
                if (!kinds[kind]) { errors.push("C8 " + where + ": dbkinds." + k + " " + kind + " is not one of the package's kinds"); return; }
                if (!generics) {
                    warnings.push("C10 " + where + ": " + cp.capability + " has no generic kind yet (docs/SYNERGY-CONNECTORS.md 3.2 rule 4); " + kind + " is the connector's own");
                    return;
                }
                const ext: string[] = Array.isArray(kinds[kind].extends) ? kinds[kind].extends : kinds[kind].extends ? [kinds[kind].extends] : [];
                if (!ext.some((e) => generics.indexOf(e) >= 0)) errors.push("C10 " + where + ": " + kind + " must extend one of " + generics.join(", "));
            });
        });
    }
    return out;
}
