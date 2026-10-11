// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A connector package from a folder (the layout of
// docs/SYNERGY-CONNECTORS.md 3.1) or an .ipk; checked (checks.ts) and
// packed into the .ipk the Marketplace takes (server/marketplace,
// Connector.php): every file under usr/palm/applications/<app id>/, the
// service in its service/ folder with the kit and the sync layer in
// service/node_modules (a device's run-js-service finds them there), no
// maintainer scripts, "Architecture: all".

/* eslint-disable @typescript-eslint/no-require-imports */
import { checkConnector, type CheckResult, type Files } from "./checks";
import { readIpk, writeIpk, type IpkFile } from "./ipk";
import { loadDefinition } from "./load";
import { shareTarget } from "../share";
import { templateSignUp } from "../signup";

export const MAX_SIZE = 64 * 1024 * 1024;
const fs = () => require("fs");
const path = () => require("path");

// Not part of a package: tests, sources of a build, version control.
const SKIP_DIRS = ["node_modules", ".git", "test", "tests", "spec", "coverage"];
function skipFile(rel: string): boolean {
    const name = rel.split("/").pop() as string;
    return /\.test\.[cm]?[jt]sx?$/.test(name) || name === ".DS_Store" || /\.tsbuildinfo$/.test(name);
}

export function readFolder(dir: string): Files {
    const out: Files = {};
    const p = path(), f = fs();
    (function walk(rel: string) {
        f.readdirSync(p.join(dir, rel), { withFileTypes: true }).forEach((e: any) => {
            const r = rel ? rel + "/" + e.name : e.name;
            if (e.isDirectory()) { if (SKIP_DIRS.indexOf(e.name) < 0) walk(r); }
            else if (e.isFile() && !skipFile(r)) out[r] = new Uint8Array(f.readFileSync(p.join(dir, r)));
        });
    })("");
    return out;
}

export interface IpkCheck extends CheckResult { control: Record<string, string> }

/** The checks of an .ipk: C13 (the package itself), then the connector profile on its app's files. */
export function checkIpk(bytes: Uint8Array, options?: { namespaces?: string[] }): IpkCheck {
    const errors: string[] = [];
    if (bytes.length > MAX_SIZE) errors.push("C13 the package is larger than 64 MB");
    let pkg;
    try { pkg = readIpk(bytes); } catch (e) {
        return { errors: errors.concat("C13 " + (e as Error).message), warnings: [], appId: "", version: "", service: "", templates: [], kinds: [], control: {} };
    }
    pkg.scripts.forEach((s) => errors.push("C13 the package has a maintainer script (" + s + "); scripts are not allowed"));
    pkg.links.forEach((l) => errors.push("C13 the package has a link (" + l + ")"));
    const apps = pkg.files.map((f) => /^usr\/palm\/applications\/([^/]+)\/appinfo\.json$/.exec(f.path)).filter(Boolean) as RegExpExecArray[];
    if (apps.length !== 1) {
        errors.push("C13 the package must hold exactly one app");
        return { errors, warnings: [], appId: "", version: "", service: "", templates: [], kinds: [], control: pkg.control };
    }
    const appId = apps[0][1];
    const prefix = "usr/palm/applications/" + appId + "/";
    const files: Files = {};
    pkg.files.forEach((f) => {
        if (f.path.indexOf(prefix) !== 0) errors.push("C13 the package puts a file outside its app (" + f.path + ")");
        else files[f.path.slice(prefix.length)] = f.data;
    });
    const r = checkConnector(files, options);
    if (pkg.control.Package !== appId) errors.push("C13 the control file's Package (" + (pkg.control.Package || "") + ") is not the app id " + appId);
    if (r.version && pkg.control.Version !== r.version) errors.push("C13 appinfo.json and the control file must give the same version");
    if (pkg.control.Architecture !== "all") errors.push("C13 only packages for any architecture (\"Architecture: all\")");
    return Object.assign(r, { errors: errors.concat(r.errors), control: pkg.control });
}

/** The kit's and the sync layer's files for service/node_modules. */
export function vendoredFiles(): { rel: string; data: Uint8Array }[] {
    const p = path(), f = fs();
    const kitRoot = p.resolve(__dirname, "..", "..");
    let syncRoot: string;
    try { syncRoot = p.dirname(require.resolve("@phoenix/synckit/package.json", { paths: [kitRoot] })); }
    catch (e) { syncRoot = p.resolve(kitRoot, "..", "synckit"); }
    const out: { rel: string; data: Uint8Array }[] = [];
    function add(root: string, name: string, sub: string) {
        out.push({ rel: "service/node_modules/" + name + "/package.json", data: new Uint8Array(f.readFileSync(p.join(root, "package.json"))) });
        const files = readFolder(p.join(root, sub));
        Object.keys(files).forEach((r) => {
            if (/\.(ts|map)$/.test(r) && !/\.d\.ts$/.test(r)) return;
            out.push({ rel: "service/node_modules/" + name + "/" + sub + "/" + r, data: files[r] });
        });
    }
    if (!f.existsSync(p.join(kitRoot, "lib", "index.js"))) throw new Error("The kit is not built: npm run build -w @phoenix/connector-kit");
    add(kitRoot, "@phoenix/connector-kit", "lib");
    add(syncRoot, "@phoenix/synckit", "src");
    return out;
}

// ---- What the definition says, in appinfo.json and the templates ---------------------------

export interface FromDefinition {
    /** Files as the definition says them (path in the folder -> text). */
    files: Record<string, string>;
    /** Those that differ from the folder's. */
    changed: string[];
    /** The definition has a share. */
    sharing: boolean;
}

function jsonText(v: unknown): string { return JSON.stringify(v, null, 4) + "\n"; }

/**
 * appinfo.json and the account templates as the definition says them
 * (docs/SYNERGY-SDK.md): appinfo.json's "phoenix".shareTargets is the one
 * entry share.ts shareTarget() makes from `share`, or none ("Sharing to
 * your service"); each template of templateIds has `signUp` from the
 * definition's, or none ("Sign-up link"). null when the folder has no
 * definition made with the kit (service/connector.js; apps/dav writes the
 * contract by hand). Throws when the definition does not load.
 */
export function fromDefinition(dir: string): FromDefinition | null {
    const p = path(), f = fs();
    if (!f.existsSync(p.join(dir, "service", "connector.js"))) return null;
    const def = loadDefinition(dir);
    if (!def || typeof def !== "object" || typeof def.service !== "string" || !Array.isArray(def.templateIds)) return null;
    const out: FromDefinition = { files: {}, changed: [], sharing: !!def.share };
    const read = (rel: string) => f.readFileSync(p.join(dir, rel), "utf8").replace(/^﻿/, "");
    function put(rel: string, before: string, value: unknown) {
        out.files[rel] = jsonText(value);
        if (JSON.stringify(JSON.parse(before)) !== JSON.stringify(value)) out.changed.push(rel);
    }

    const infoText = read("appinfo.json");
    const info = JSON.parse(infoText);
    const target = shareTarget(def, String(info.title || info.id));
    const phoenix = info.phoenix && typeof info.phoenix === "object" ? info.phoenix : (info.phoenix = {});
    if (target) phoenix.shareTargets = [target];
    else delete phoenix.shareTargets;
    put("appinfo.json", infoText, info);

    const byTemplate = def.signUpByTemplate && typeof def.signUpByTemplate === "object" ? def.signUpByTemplate : {};
    def.templateIds.forEach((id: string) => {
        const signUp = templateSignUp(byTemplate[id] !== undefined ? byTemplate[id] : def.signUp);
        const rel = "public/accounts/" + id + "/" + id + ".json";
        if (!f.existsSync(p.join(dir, rel))) return;
        const text = read(rel);
        const t = JSON.parse(text);
        (Array.isArray(t) ? t : [t]).forEach((tpl: any) => {
            if (!tpl || typeof tpl !== "object") return;
            if (signUp) tpl.signUp = signUp;
            else delete tpl.signUp;
        });
        put(rel, text, t);
    });
    return out;
}

/** Writes what the definition says into appinfo.json and the templates; the files changed. */
export function writeFromDefinition(dir: string): string[] {
    const r = fromDefinition(dir);
    if (!r) return [];
    r.changed.forEach((rel) => fs().writeFileSync(path().join(dir, rel), r.files[rel]));
    return r.changed;
}

/** C14, C16 for a folder: appinfo.json and the templates say what the definition says (validate). */
export function definitionProblems(dir: string): { errors: string[]; warnings: string[] } {
    try {
        const r = fromDefinition(dir);
        if (!r) return { errors: [], warnings: [] };
        return { errors: r.changed.map((rel) => rel === "appinfo.json"
            ? "C14 appinfo.json: shareTargets is not what the definition's share says (phoenix-connector pack writes it)"
            : "C16 " + rel + ": signUp is not what the definition's signUp says (phoenix-connector pack writes it)"), warnings: [] };
    } catch (e) {
        return { errors: [], warnings: ["C14 the definition (service/connector.js) did not load, so its share and signUp were not compared: " + (e as Error).message] };
    }
}

export interface PackResult { file: string; size: number; check: CheckResult; written: string[] }

// vendor: false leaves the kit out (tests; a package must carry it to run on a device).
// writeAppinfo: false packs appinfo.json and the templates as they are (still checked, C14, C16).
export function pack(dir: string, outDir: string, options?: { namespaces?: string[]; force?: boolean; vendor?: boolean; writeAppinfo?: boolean }): PackResult {
    const p = path(), f = fs();
    // The share target and the sign-up link from the definition, into the folder's files first.
    const written = options && options.writeAppinfo === false ? [] : writeFromDefinition(dir);
    const files = readFolder(dir);
    const check = checkConnector(files, options);
    if (check.errors.length && !(options && options.force))
        throw Object.assign(new Error("The package does not pass the checks:\n  " + check.errors.join("\n  ")), { check });
    const vendored = options && options.vendor === false ? [] : vendoredFiles();
    const info = JSON.parse(Buffer.from(files["appinfo.json"]).toString("utf8").replace(/^﻿/, ""));
    const prefix = "usr/palm/applications/" + info.id + "/";
    const list: IpkFile[] = Object.keys(files).sort().map((rel) => ({ path: prefix + rel, data: files[rel] }));
    vendored.forEach((v) => list.push({ path: prefix + v.rel, data: v.data }));
    const bytes = writeIpk({
        Package: info.id, Version: String(info.version), Section: "connector", Priority: "optional", Architecture: "all",
        Maintainer: String(info.vendor || "unknown"), Description: String(info.title || info.id) + " (Synergy connector)"
    }, list);
    if (bytes.length > MAX_SIZE) throw new Error("The package is larger than 64 MB");
    f.mkdirSync(outDir, { recursive: true });
    const file = p.join(outDir, info.id + "_" + info.version + "_all.ipk");
    f.writeFileSync(file, Buffer.from(bytes));
    return { file, size: bytes.length, check, written };
}
