// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-connector: the connector developer's command (docs/SYNERGY-SDK.md).
//
//   phoenix-connector new <app id> [--capability CONTACTS] [--dir DIR]
//       a connector's folder, ready to fill in
//   phoenix-connector validate <folder | .ipk> [--namespace NS]...
//       the Marketplace's checks (checks.ts; the server runs the same)
//   phoenix-connector pack <folder> [--out DIR] [--namespace NS]... [--force]
//       the .ipk the Marketplace takes
//   phoenix-connector test <folder>
//       the conformance suite, with the connector's fixture
//       (service/test/fixture.js: module.exports = {template, validateParams, server(), ...})
//
// Exit status: 0 when all is well, 1 when a check or test failed, 2 for a usage error.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { checkConnector } from "./checks";
import { checkIpk, pack, readFolder } from "./package";
import { scaffold, squarePng } from "./scaffold";

const USAGE = [
    "usage: phoenix-connector new <app id> [--capability CONTACTS] [--dir DIR]",
    "       phoenix-connector validate <folder | file.ipk> [--namespace NS]...",
    "       phoenix-connector pack <folder> [--out DIR] [--namespace NS]... [--force]",
    "       phoenix-connector test <folder>"
].join("\n");

interface Args { _: string[]; [k: string]: any }

export function parseArgs(argv: string[]): Args {
    const out: Args = { _: [], namespace: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--force" || a === "--json") out[a.slice(2)] = true;
        else if (a === "--namespace") out.namespace.push(argv[++i]);
        else if (/^--[a-z]+$/.test(a)) out[a.slice(2)] = argv[++i];
        else out._.push(a);
    }
    return out;
}

function print(lines: string[], log: (s: string) => void) { lines.forEach((l) => log(l)); }

export async function main(argv: string[], io?: { log?(s: string): void; err?(s: string): void }): Promise<number> {
    const log = (io && io.log) || ((s: string) => console.log(s));
    const err = (io && io.err) || ((s: string) => console.error(s));
    const fs = require("fs");
    const path = require("path");
    const args = parseArgs(argv);
    const cmd = args._[0];
    const ns = args.namespace.length ? args.namespace : undefined;

    if (cmd === "new") {
        const appId = args._[1];
        if (!appId) { err(USAGE); return 2; }
        let made;
        try { made = scaffold(appId, args.capability || "CONTACTS"); } catch (e) { err("phoenix-connector new: " + (e as Error).message); return 2; }
        const dir = path.resolve(args.dir || appId);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length) { err("phoenix-connector new: " + dir + " is not empty"); return 2; }
        Object.keys(made.files).forEach((rel) => {
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), made.files[rel]);
        });
        // Placeholder pictures, to be replaced (with their @2x and @3x).
        const img = path.join(dir, "public/accounts", made.templateId, "images");
        fs.mkdirSync(img, { recursive: true });
        [32, 48].forEach((s) => [1, 2, 3].forEach((k) => {
            fs.writeFileSync(path.join(img, "icon-" + s + "x" + s + (k > 1 ? "@" + k + "x" : "") + ".png"), squarePng(s * k, [90, 120, 160]));
        }));
        fs.writeFileSync(path.join(dir, "icon.png"), squarePng(64, [90, 120, 160]));
        log("Made " + dir + ": the service " + made.service + ", the template " + made.templateId + ".");
        log("Next: write pull() in service/connector.js, then phoenix-connector validate " + path.relative(process.cwd(), dir));
        return 0;
    }

    if (cmd === "validate") {
        const target = args._[1];
        if (!target) { err(USAGE); return 2; }
        let r;
        try {
            r = /\.ipk$/i.test(target) ? checkIpk(new Uint8Array(fs.readFileSync(target)), { namespaces: ns })
                                       : checkConnector(readFolder(target), { namespaces: ns });
        } catch (e) { err("phoenix-connector validate: " + (e as Error).message); return 2; }
        if (args.json) { log(JSON.stringify(r, null, 2)); return r.errors.length ? 1 : 0; }
        log((r.appId || target) + (r.version ? " " + r.version : "") + (r.service ? ", service " + r.service : "") +
            (r.templates.length ? ", templates " + r.templates.join(", ") : ""));
        print(r.errors.map((e) => "error   " + e), log);
        print(r.warnings.map((w) => "warning " + w), log);
        log(r.errors.length ? r.errors.length + " error(s): the Marketplace would refuse this package" : "ok: the Marketplace's checks pass" +
            (r.warnings.length ? " (" + r.warnings.length + " warning(s))" : ""));
        return r.errors.length ? 1 : 0;
    }

    if (cmd === "pack") {
        const dir = args._[1];
        if (!dir) { err(USAGE); return 2; }
        try {
            const r = pack(path.resolve(dir), path.resolve(args.out || "."), { namespaces: ns, force: !!args.force });
            print(r.check.warnings.map((w) => "warning " + w), log);
            log("Packed " + r.file + " (" + Math.round(r.size / 1024) + " KB)");
            return 0;
        } catch (e) {
            err("phoenix-connector pack: " + (e as Error).message);
            return 1;
        }
    }

    if (cmd === "test") {
        const dir = path.resolve(args._[1] || ".");
        const { runConformance } = require("../conformance");
        let def, fixture;
        try {
            def = require(path.join(dir, "service", "connector.js"));
            fixture = require(path.join(dir, "service", "test", "fixture.js"));
        } catch (e) { err("phoenix-connector test: " + (e as Error).message); return 2; }
        const results = await runConformance(def, fixture);
        results.forEach((r: any) => log((r.ok ? "ok   " : "FAIL ") + r.name + (r.error ? "\n       " + r.error : "")));
        const failed = results.filter((r: any) => !r.ok).length;
        log(failed ? failed + " of " + results.length + " checks failed" : "all " + results.length + " checks passed");
        return failed ? 1 : 0;
    }

    err(USAGE);
    return 2;
}
