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
//   C14 share targets (appinfo.json "phoenix".shareTargets): each one a
//       connector's, written from the definition's share (no hand-written
//       ones), its template one of the package's, its service the
//       package's, accepts and audience well formed, types the ones accepts
//       gives (share.ts shareTypes)
//   C15 sharing reaches the service: the api.json lists <service>/share in
//       a group the app's requiredPermissions name; the app's main page,
//       which the sheet opens to compose, is in the package
//   C16 the template's sign-up link (signUp: {url?, servers?: [{name,
//       url}]}, written from the definition's signUp): https addresses only
//   C17 a sign-in page of its own (validator.customUI) only in Phoenix's own
//       connectors (firstParty): Accounts shows the page in a frame of its
//       card, so the page calls with Accounts' groups, which hold every
//       Phoenix connector's sign-in group (docs/DEVICE-AUDIT.md). Until each
//       page runs as its own connector (docs/ROADMAP.md, per-connector
//       sign-in isolation), a third-party connector uses the standard
//       sign-in: Accounts' user name and password, sent to its validator.
//   C18 a third-party connector's (not firstParty) bus groups, least
//       privilege: its service's perm.json claims only groups of its own
//       and THIRD_PARTY_GROUPS; a group of its own is one its api.json
//       defines, named in its namespace, listing only its service's
//       methods (luna-hub's groups are global and joined across packages,
//       so a group named like another's, or listing another service's
//       methods, would claim theirs); the perm file names only its
//       service; its groups.json sets the trust of its own groups only
//       and leaves the connector protocol's (SHARED_GROUPS) at oem.
//       Phoenix's own connectors are checked against what their calls
//       need instead (tools/check-luna.py, tools/test-devicecheck.py).
//   C19 a third-party connector's app's groups (appinfo.json
//       requiredPermissions), least privilege: a list (without one,
//       OSE's installer gives the app the public group), naming only the
//       package's own groups (C18's) and THIRD_PARTY_APP_GROUPS, what the
//       kit's pages call (share-page/compose.js). OSE's installer copies the
//       list into the app's client permissions as it is, with the oem trust
//       level (appinstalld2 ServiceInstallerUtility.cpp), so the list is the
//       app's privilege on the bus.
//   C20 a third-party connector's names: its ids (app, service, templates,
//       own kinds) are not in a namespace the
//       system's names use (RESERVED_NAMESPACES: luna-hub keeps no names
//       for the system, docs/DEVICE-AUDIT.md "Names and groups on the
//       hub"), and its app id is in the developer's namespace; its sysbus
//       files are its service's only (<service>.<kind>), the .service file
//       names its service and runs it with run-js-service from
//       /usr/palm/services/<service>, the role is a regular one for its
//       service (no exeName, no trust level above dev: the system sets
//       trust), and the manifest is its service's (id, its own files): the
//       hub keeps the manifest of an id with the highest version, so a
//       manifest named like another would unload that one's files.
//
// files: the package's files by path relative to the app's folder.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { acceptsProblems, audienceProblems, shareTypes } from "../share";
import { signUpProblems } from "../signup";

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

/** The services a connector's service may call (3.2 rule 10, and what SOCIAL and MESSAGING connectors need; a drive's transfers show in the ongoing activities). */
export const ALLOWED_OUTBOUND = ["com.palm.db", "com.palm.tempdb", "com.palm.activitymanager", "com.palm.service.accounts",
                                 "org.webosphoenix.service.oauth", "org.webosphoenix.service.keystore", "org.webosphoenix.service.push",
                                 "com.webos.notification", "org.webosports.service.messaging", "org.webosphoenix.ongoing"];

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

/**
 * Phoenix's own connector: its app id is in Phoenix's namespace and it is
 * checked with Phoenix's namespaces. The catalogs give those only to
 * Phoenix's packages (server/marketplace Catalog::submitPackage: an admin's
 * upload; a developer's org.webosphoenix.* id is refused there and in
 * Phoenix-Web-Services), and the devices trust them from preinstalled.json
 * (apps/marketplace packagesservice.js firstPartyEntry).
 */
export const PHOENIX_NAMESPACE = "org.webosphoenix";

export function isFirstParty(appId: string, namespaces: string[]): boolean {
    return appId.indexOf(PHOENIX_NAMESPACE + ".") === 0 && namespaces.indexOf(PHOENIX_NAMESPACE) >= 0;
}

/**
 * C18: the groups a third-party connector's service may claim besides its
 * own (docs/SYNERGY-SDK.md "Validating and packing"). Each is one the kit's
 * calls need (KIT_CALLS in tools/devicecheck/luna.py) and that the service
 * providing it confines to the caller's own data; every other group is
 * refused, by name.
 *
 *   database.operation      db8 (com.palm.db): each kind's permissions decide
 *                           who reads or writes it, and C10/C11 keep the
 *                           package's kinds and permissions its own
 *   tempdatabase.operation  the same for com.palm.tempdb (C10/C11 cover its kinds)
 *   activity.operation      the activity manager: the kit's sync schedule and
 *                           db8 watches (create, cancel, complete)
 *   accounts.transport      the connector protocol (SHARED_GROUPS): the kit
 *                           calls its own service's sync; C9's outbound lets
 *                           the service reach no other connector
 *   phoenix.accounts.info   getAccountInfo alone; phoenix.accounts.read-credentials
 *                           readCredentials alone: the kit reads each account it
 *                           works on (service.ts accountContext). Which accounts:
 *                           the template's readPermissions, checked per caller
 *                           (third_party/app-services com.palm.service.accounts
 *                           utils.js hasPermission, exact ids, no list means no
 *                           one); C5 keeps a third party's ids in its namespace
 *   oauth.signin            the OAuth service (ctx.oauth, kit.oauthSignIn): a key
 *                           belongs to the caller that made it (services/oauth
 *                           oauthservice.js owned, ownerOf)
 *   notification.operation  ctx.notify: createToast and createAlert only; reading
 *                           or closing others' is notification.management
 *
 * Not on the list, so refused: the whole accounts service
 * (phoenix.appservices.accounts: create, change, delete any account),
 * phoenix.accounts.list (listAccounts answers every account, no
 * readPermissions), phoenix.ongoing (set takes any app id, clear any row),
 * oauth.card and oauth.erase, every connector's own groups (phoenix.<name>.signin,
 * phoenix.<name>.messaging, <name>.account, ...) and groups no service defines
 * (accounts.operation, messaging.operation: a later definition would hand
 * every holder its methods).
 */
export const THIRD_PARTY_GROUPS = ["database.operation", "tempdatabase.operation", "activity.operation", "accounts.transport",
                                   "phoenix.accounts.info", "phoenix.accounts.read-credentials", "oauth.signin", "notification.operation"];

/**
 * The connector protocol's groups: every connector's api.json adds its
 * methods to them (Accounts holds accounts.transport, the Assistant
 * phoenix.connector.share), so their names are not a developer's. Their
 * trust is the system's, oem.
 */
export const SHARED_GROUPS = ["accounts.transport", "phoenix.connector.share"];

/**
 * C19: the groups a third-party connector's app may name besides its own
 * (its service's share group): what the kit's compose page calls
 * (share-page/compose.js), each confined to the caller's own.
 *
 *   phoenix.accounts.mine    listMyAccounts alone: the accounts whose template's
 *                            readPermissions name the app (compat/app-services
 *                            com.palm.service.accounts handlers/list-my-accounts.js,
 *                            utils.js hasPermission), for the account picker;
 *                            phoenix.accounts.list would answer every account
 *   phoenix.appmanager.open  com.palm.applicationManager/open alone (services/
 *                            appmanager): Accounts with the template ({id, params})
 *                            and the posted link ({target}); not
 *                            phoenix.appmanager.launch, which also adds and
 *                            removes launch points and resource handlers
 *
 * Not on the list, so refused: accounts.transport (the connector protocol's
 * oem group: Accounts calls the service, the app never does; since C17 the
 * app has no sign-in page), phoenix.connector.share (the Assistant's: it
 * reaches every connector's share), phoenix.appmanager.launch, the accounts
 * service's other groups and every other group.
 */
export const THIRD_PARTY_APP_GROUPS = ["phoenix.accounts.mine", "phoenix.appmanager.open"];

/**
 * C20: namespaces the system's names use (webOS's, OSE's, LG's, LuneOS's,
 * Phoenix's apps and services, and Phoenix's templates). luna-hub refuses
 * no name to a package (docs/DEVICE-AUDIT.md "Names and groups on the hub"),
 * and the accounts service tells callers by these names (templates'
 * readPermissions: org.webosphoenix.messaging reads the IM accounts), so a
 * third party's ids stay out of them. Phoenix's own (firstParty) are its.
 */
export const RESERVED_NAMESPACES = ["com.palm", "com.webos", "com.lge", "org.webosports", "org.webosphoenix", "com.webosphoenix"];

/** C20: the sysbus files a connector's service has, by kind. */
const SYSBUS_KINDS = [".service", ".role.json", ".api.json", ".perm.json", ".groups.json", ".manifest.json"];
const MANIFEST_DIRS: Record<string, [string, string]> = {
    roleFiles: ["roles.d", ".role.json"], serviceFiles: ["services.d", ".service"], apiPermissionFiles: ["api-permissions.d", ".api.json"],
    clientPermissionFiles: ["client-permissions.d", ".perm.json"], groupsFiles: ["groups.d", ".groups.json"]
};

/** C17's answer to a third-party connector's own sign-in page. */
export const THIRD_PARTY_SIGNIN = "Custom sign-in pages from third-party connectors aren't supported yet; use the connector kit's standard sign-in";

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
    const firstParty = isFirstParty(appId, namespaces);

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
    Object.keys(files).sort().filter((p) => /^configuration\/(?:db|tempdb)\/kinds\/[^/]+$/.test(p)).forEach((p) => {
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
    Object.keys(files).sort().filter((p) => /^configuration\/(?:db|tempdb)\/permissions\/[^/]+$/.test(p)).forEach((p) => {
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
        signUpProblems(tpl.signUp).forEach((p) => errors.push("C16 " + id + ": " + p));
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

        // C17 a sign-in page of its own: Phoenix's own connectors only
        if (v && typeof v === "object" && v.customUI !== undefined && v.customUI !== null && !firstParty) errors.push("C17 " + id + ": " + THIRD_PARTY_SIGNIN);

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

    // C18 a third-party connector's groups (THIRD_PARTY_GROUPS, SHARED_GROUPS)
    const own: string[] = [];
    if (!firstParty && service && ID.test(service)) checkGroups();
    function checkGroups() {
        const ns = namespaces.join(", ");
        const apiPath = "service/sysbus/" + service + ".api.json";
        const api = json(files, apiPath);
        if (files[apiPath] && (!api.ok || !api.value || typeof api.value !== "object" || Array.isArray(api.value))) errors.push("C18 " + apiPath + ": not valid JSON (an object: each group and its methods)");
        else if (api.ok) Object.keys(api.value).forEach((g) => {
            const shared = SHARED_GROUPS.indexOf(g) >= 0;
            if (!shared && !inNamespace(g, namespaces))
                errors.push("C18 the api.json's group " + g + " is not in the namespace " + ns + ": name a group of your own in it (" + SHARED_GROUPS.join(" and ") + " are the connector protocol's)");
            const methods = api.value[g];
            const others = Array.isArray(methods) ? methods.filter((m: unknown) => typeof m !== "string" || m.indexOf(service + "/") !== 0) : [methods];
            others.forEach((m: unknown) => errors.push("C18 the api.json's group " + g + " lists " + JSON.stringify(m) + ": a connector's groups list only its service's methods (" + service + "/<method>)"));
            if (!shared && inNamespace(g, namespaces) && !others.length) own.push(g);
        });
        const claims = "a third-party connector claims only its own groups (its api.json's, named in " + ns + ") and " + THIRD_PARTY_GROUPS.join(", ");
        Object.keys(files).sort().filter((p) => /^service\/sysbus\/[^/]+\.perm\.json$/.test(p)).forEach((p) => {
            const perm = json(files, p);
            if (!perm.ok || !perm.value || typeof perm.value !== "object" || Array.isArray(perm.value)) { errors.push("C18 " + p + ": not valid JSON (an object: the service and the groups it claims)"); return; }
            Object.keys(perm.value).forEach((name) => {
                if (name !== service) { errors.push("C18 " + p + ": claims groups for " + name + "; a connector's perm file names only its service, " + service); return; }
                const groups = perm.value[name];
                if (!Array.isArray(groups)) { errors.push("C18 " + p + ": " + service + "'s groups must be a list"); return; }
                groups.forEach((g: unknown) => {
                    if (typeof g !== "string" || (own.indexOf(g) < 0 && THIRD_PARTY_GROUPS.indexOf(g) < 0))
                        errors.push("C18 " + service + " may not claim the group " + (typeof g === "string" ? g : JSON.stringify(g)) + ": " + claims);
                });
            });
        });
        Object.keys(files).sort().filter((p) => /^service\/sysbus\/[^/]+\.groups\.json$/.test(p)).forEach((p) => {
            const gr = json(files, p);
            if (!gr.ok || !gr.value || typeof gr.value !== "object" || Array.isArray(gr.value)) { errors.push("C18 " + p + ": not valid JSON (an object: each group and its trust levels)"); return; }
            Object.keys(gr.value).forEach((g) => {
                const v = gr.value[g];
                if (g === "allowedNames") {
                    if (!Array.isArray(v) || v.length !== 1 || v[0] !== service) errors.push("C18 " + p + ": allowedNames must be [\"" + service + "\"]");
                } else if (SHARED_GROUPS.indexOf(g) >= 0) {
                    if (!Array.isArray(v) || v.length !== 1 || v[0] !== "oem") errors.push("C18 " + p + ": the trust of " + g + " is the system's, [\"oem\"]; a connector may not change it");
                } else if (own.indexOf(g) < 0) {
                    errors.push("C18 " + p + ": sets the trust of " + g + ", not a group of the package's own (its api.json's, named in " + ns + ")");
                } else if (!Array.isArray(v) || !v.length || v.some((t: unknown) => typeof t !== "string")) {
                    errors.push("C18 " + p + ": the trust of " + g + " must be a list of trust levels");
                }
            });
        });
    }

    // C19 a third-party connector's app's groups (THIRD_PARTY_APP_GROUPS)
    if (!firstParty) {
        const req = info.value.requiredPermissions;
        const appClaims = "a third-party connector's app names only its own groups (its api.json's, named in " + namespaces.join(", ") +
            ") and " + THIRD_PARTY_APP_GROUPS.join(", ");
        if (!Array.isArray(req)) errors.push("C19 appinfo.json requiredPermissions must be a list (an empty one is fine): without it the installer gives the app the public group");
        else req.forEach((g: unknown) => {
            if (typeof g !== "string" || (own.indexOf(g) < 0 && THIRD_PARTY_APP_GROUPS.indexOf(g) < 0))
                errors.push("C19 appinfo.json requiredPermissions may not name " + (typeof g === "string" ? g : JSON.stringify(g)) + ": " + appClaims);
        });
    }

    // C20 a third-party connector's names (RESERVED_NAMESPACES)
    if (!firstParty) checkNames();
    function checkNames() {
        const ns = namespaces.join(", ");
        if (ID.test(appId) && !inNamespace(appId, namespaces)) errors.push("C20 the app id " + appId + " is not in the namespace " + ns);
        const ids: [string, string][] = [["the app id", appId], ["the service", service]];
        out.templates.forEach((t) => ids.push(["the template", t]));
        out.kinds.filter((k) => !genericPrefixOf(k)).forEach((k) => ids.push(["the kind", k.replace(/:\d+$/, "")]));
        ids.forEach(([what, id]) => {
            const r = RESERVED_NAMESPACES.filter((n) => inNamespace(id, [n]))[0];
            if (id && r) errors.push("C20 " + what + " " + id + " is in " + r + ", a namespace of the system's names: use your own");
        });
        if (!service || !ID.test(service)) return;
        Object.keys(files).sort().filter((p) => p.indexOf("service/sysbus/") === 0).forEach((p) => {
            const name = p.slice("service/sysbus/".length);
            if (!SYSBUS_KINDS.some((k) => name === service + k))
                errors.push("C20 " + p + ": a connector's sysbus files are its service's, " + SYSBUS_KINDS.map((k) => service + k).join(", "));
        });
        const svcPath = "service/sysbus/" + service + ".service";
        if (files[svcPath]) {
            const exec = "/usr/bin/run-js-service -n /usr/palm/services/" + service;
            const lines = text(files[svcPath]).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.charAt(0) !== "#" && l !== "[D-BUS Service]");
            const keys: Record<string, string> = {};
            lines.forEach((l) => {
                const m = /^([A-Za-z]+)=(.*)$/.exec(l);
                if (!m || ["Name", "Exec", "Type"].indexOf(m[1]) < 0 || keys[m[1]] !== undefined)
                    errors.push("C20 " + svcPath + ": " + JSON.stringify(l) + " is not one of Name=, Exec=, Type= (once each)");
                else keys[m[1]] = m[2].trim();
            });
            if (keys.Name !== service) errors.push("C20 " + svcPath + ": Name= must be " + service + " alone");
            if (keys.Exec !== exec) errors.push("C20 " + svcPath + ": Exec= must be " + exec);
            if (keys.Type !== undefined && keys.Type !== "dynamic") errors.push("C20 " + svcPath + ": Type= must be dynamic");
        }
        const role = json(files, "service/sysbus/" + service + ".role.json");
        if (role.ok && role.value && typeof role.value === "object" && !Array.isArray(role.value)) {
            const where = "C20 service/sysbus/" + service + ".role.json: ";
            Object.keys(role.value).forEach((k) => {
                if (["appId", "type", "allowedNames", "permissions", "trustLevel"].indexOf(k) < 0) errors.push(where + k + " is not for a connector's role (appId, type, allowedNames, permissions)");
            });
            if (role.value.appId !== undefined && role.value.appId !== service) errors.push(where + "appId must be " + service);
            if (role.value.type !== undefined && role.value.type !== "regular") errors.push(where + "type must be \"regular\" (\"privileged\" may take any name)");
            if (role.value.trustLevel !== undefined && role.value.trustLevel !== "dev") errors.push(where + "a connector may not raise its trust level (" + JSON.stringify(role.value.trustLevel) + "): the system sets it");
            (Array.isArray(role.value.permissions) ? role.value.permissions : []).forEach((perm: any) => {
                if (!perm || perm.service !== service) errors.push(where + "its permissions are for " + service + " only");
            });
        }
        const manPath = "service/sysbus/" + service + ".manifest.json";
        const man = json(files, manPath);
        if (files[manPath] && (!man.ok || !man.value || typeof man.value !== "object" || Array.isArray(man.value))) errors.push("C20 " + manPath + ": not valid JSON");
        else if (man.ok) {
            if (man.value.id !== service) errors.push("C20 " + manPath + ": id must be " + service + " (the hub keeps one manifest per id, the highest version's)");
            Object.keys(man.value).forEach((k) => {
                if (k === "id" || k === "version") return;
                const d = MANIFEST_DIRS[k];
                if (!d) { errors.push("C20 " + manPath + ": " + k + " is not a manifest's list of files"); return; }
                const want = "/usr/share/luna-service2/" + d[0] + "/" + service + d[1];
                const list = man.value[k];
                if (!Array.isArray(list) || list.some((f: unknown) => f !== want)) errors.push("C20 " + manPath + ": " + k + " may list only " + want);
            });
        }
    }

    // C14, C15 sharing (share.ts)
    const targets = info.value.phoenix && info.value.phoenix.shareTargets;
    if (targets !== undefined) {
        if (!Array.isArray(targets)) errors.push("C14 appinfo.json: shareTargets must be a list");
        else checkShareTargets(targets);
    }
    function checkShareTargets(list: any[]) {
        let sharing = false;
        list.forEach((t: any, i: number) => {
            const where = "C14 appinfo.json shareTargets[" + i + "]";
            const c = t && t.connector;
            if (!c || typeof c !== "object" || Array.isArray(c)) {
                errors.push(where + ": a connector's share target is written from its definition's share (phoenix-connector pack), not by hand");
                return;
            }
            sharing = true;
            if (typeof t.label !== "string" || !t.label) errors.push(where + ": label must be a string");
            if (out.templates.indexOf(c.templateId) < 0) errors.push(where + ": connector.templateId " + c.templateId + " is not one of the package's templates");
            if (c.service !== service) errors.push(where + ": connector.service must be " + (service || "the package's service"));
            if (c.accountLabel !== undefined && typeof c.accountLabel !== "string") errors.push(where + ": connector.accountLabel must be a string");
            const bad = acceptsProblems(c.accepts).concat(audienceProblems(c.audience));
            bad.forEach((b) => errors.push(where + ": connector." + b));
            if (!bad.length) {
                const want = shareTypes(c.accepts).slice().sort();
                const got = (Array.isArray(t.types) ? t.types.slice() : []).sort();
                if (JSON.stringify(want) !== JSON.stringify(got)) errors.push(where + ": types must be " + want.join(", ") + " (what accepts takes)");
            }
        });
        if (!sharing || !service) return;
        const api = json(files, "service/sysbus/" + service + ".api.json");
        const groups = api.ok && api.value && typeof api.value === "object" ? Object.keys(api.value).filter((g) =>
            Array.isArray(api.value[g]) && api.value[g].indexOf(service + "/share") >= 0) : [];
        const required: string[] = Array.isArray(info.value.requiredPermissions) ? info.value.requiredPermissions : [];
        if (!groups.length) errors.push("C15 the api.json must list " + service + "/share (the compose page calls it)");
        else if (!groups.some((g) => required.indexOf(g) >= 0))
            errors.push("C15 appinfo.json requiredPermissions must name the group of " + service + "/share (" + groups.join(", ") + ")");
        const main = String(info.value.main || "index.html");
        if (!files[main]) errors.push("C15 the app's main page " + main + " is not in the package: the share sheet opens it to compose");
    }
    return out;
}
