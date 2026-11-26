#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// nova: webOS Phoenix's developer command (docs/DEV-PUSH.md), after Nova,
// Palm's codename for webOS that novacom and novaterm are named for, with
// Palm's SDK verbs as subcommands. Node.js 22, nothing beyond the
// checkout: run it as ./phoenix nova ..., or put it on the PATH
// (ln -s "$PWD/tools/nova/nova.cjs" /usr/local/bin/nova).
//
// Built (P1):
//   nova package APPDIR [-o DIR]       an app's .ipk (palm-package)
//   nova package --system --manifest FILE [options]
//                                      a dev bundle of what differs from an image
//   nova verify BUNDLE [options]       check a dev bundle as a device would
//   nova key                           this computer's key (made on first use)
// To come (P2 and later, docs/DEV-PUSH.md 12): devices, pair, unpair, push,
// put, get, status, revert, restart, rescan, install, launch, log,
// luna-send, term, send.

"use strict";

const fs = require("fs");
const path = require("path");

const USAGE = `nova: webOS Phoenix's developer command (docs/DEV-PUSH.md)

  nova package APPDIR [-o DIR]
      An app's .ipk, <id>_<version>_all.ipk (Palm's palm-package)

  nova package --system --manifest FILE [-o FILE] [options]
      A dev bundle: the files of this checkout that differ from the image
      whose manifest.json is FILE (/usr/share/phoenix/manifest.json on the
      device), signed with this computer's key. Writes BUNDLE.ipk and
      BUNDLE.ipk.sig (default devpush-<build>-<id>.ipk)
        --device ID       for this device only (default: any device of that build)
        --compatible NAME for this device type only (default: the manifest's)
        --add             add to what the device's overlay holds (default: replace it)
        --note TEXT       what it is, shown on the device
        --only PATH       only device paths under PATH (repeatable)
        --allow-compiled  make it even though compiled parts changed (they stay as the image's)
        --counter N, --made TIME   set them (default: now; SOURCE_DATE_EPOCH)
        --repo DIR        the checkout (default: the one nova is in)
        --dry-run         say what it would hold; write nothing

  nova verify BUNDLE [--sig FILE] [--trust KEY]... --build ID --product LINE
              [--compatible NAME] [--device ID] [--last-counter N]
      The device's checks (docs/DEV-PUSH.md 5.3). Trusts this computer's key
      unless --trust names keys (ed25519:<base64>, or a key.pub file)

  nova key
      This computer's public key and fingerprint (made on first use)

  Every command: --key FILE (default ~/.config/nova/key), -h/--help

Still to come (docs/DEV-PUSH.md 12, P2): devices, pair, unpair, push, put,
get, status, revert, restart, rescan, install, launch, log, luna-send, term,
send.`;

const LATER = ["devices", "pair", "unpair", "push", "put", "get", "status", "revert", "restart", "rescan", "install",
               "launch", "log", "luna-send", "term", "send", "generate", "inspect"];

class UsageError extends Error {}

// argv -> {_: [positional], flags}. specs: {name: "bool" | "value" | "list"}.
function parseArgs(argv, specs) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--") { out._.push(...argv.slice(i + 1)); break; }
        if (!a.startsWith("-") || a === "-") { out._.push(a); continue; }
        let name = a.replace(/^--?/, ""), value;
        const eq = name.indexOf("=");
        if (eq >= 0) { value = name.slice(eq + 1); name = name.slice(0, eq); }
        if (name === "o") name = "out";
        if (name === "d") name = "device";
        if (name === "h") name = "help";
        const kind = specs[name];
        if (!kind) throw new UsageError("unknown option " + a);
        if (kind === "bool") { out[name] = true; continue; }
        if (value === undefined) {
            if (i + 1 >= argv.length) throw new UsageError(a + " needs a value");
            value = argv[++i];
        }
        if (kind === "list") (out[name] = out[name] || []).push(value);
        else out[name] = value;
    }
    return out;
}

function trustKey(text) {
    let t = String(text).trim();
    if (fs.existsSync(t)) t = fs.readFileSync(t, "utf8").trim();
    const m = /^(?:ed25519:)?([A-Za-z0-9+/]{43}=)$/.exec(t);
    if (!m) throw new UsageError("--trust: not an Ed25519 public key (ed25519:<base64>): " + text);
    return m[1];
}

function size(n) {
    return n < 1024 ? n + " B" : n < 1 << 20 ? (n / 1024).toFixed(1) + " KB" : (n / (1 << 20)).toFixed(1) + " MB";
}

async function cmdPackage(argv, out) {
    const a = parseArgs(argv, { system: "bool", manifest: "value", out: "value", device: "value", compatible: "value", add: "bool",
                                note: "value", only: "list", "allow-compiled": "bool", counter: "value", made: "value",
                                repo: "value", "dry-run": "bool", key: "value", help: "bool" });
    if (a.help) { out.log(USAGE); return 0; }
    const bundle = require("./lib/bundle.cjs");
    if (!a.system) {
        if (a._.length !== 1) throw new UsageError("nova package APPDIR (or --system)");
        const r = await bundle.packageApp(a._[0]);
        const file = path.join(a.out || ".", r.name);
        fs.writeFileSync(file, r.bytes);
        out.log(`Packaged ${r.appinfo.id} ${r.appinfo.version}: ${file} (${r.files} files, ${size(r.bytes.length)})`);
        return 0;
    }
    if (a._.length) throw new UsageError("nova package --system takes no folder (only device paths with --only)");
    if (!a.manifest) throw new UsageError("nova package --system needs the image's manifest: --manifest FILE (P2 reads it from the device)");
    if (a.counter !== undefined && !/^[1-9]\d{0,15}$/.test(a.counter)) throw new UsageError("--counter: a positive whole number");
    const keys = require("./lib/keys.cjs");
    const key = keys.load(a.key);
    if (key.made) out.err(`Made this computer's nova key: ${key.file} (${key.fingerprint})`);
    const r = await bundle.makeSystemBundle({
        repo: a.repo ? path.resolve(a.repo) : undefined, manifest: bundle.readImageManifest(a.manifest), key,
        device: a.device, compatible: a.compatible, mode: a.add ? "add" : "replace", note: a.note, only: a.only,
        allowCompiled: !!a["allow-compiled"], counter: a.counter, made: a.made, log: (t) => out.err(t),
    });
    if (r.nothing) { out.log("Nothing differs from the image: no bundle made."); return 0; }
    const m = r.manifest;
    const lines = m.files.map((f) => "  " + f.path).concat(m.removed.map((p) => "  removed " + p));
    out.log(`Dev bundle ${m.id} for build ${m.build} (webOS Phoenix ${m.product}${m.compatible ? ", " + m.compatible : ""}, device ${m.device}):`);
    out.log(lines.join("\n"));
    out.log(`${m.files.length} files, ${m.removed.length} removed, ${size(r.bytes.length)}; parts: ${m.parts.join(", ")}; restarts: ${m.restart.join(", ")}`);
    if (a["dry-run"]) { out.log("(dry run: nothing written)"); return 0; }
    const file = a.out || `devpush-${m.build}-${m.id.slice(0, 8)}.ipk`;
    fs.writeFileSync(file, r.bytes);
    fs.writeFileSync(file + ".sig", r.signature);
    out.log(`Wrote ${file} and ${file}.sig, signed by ${key.fingerprint}`);
    return 0;
}

async function cmdVerify(argv, out) {
    const a = parseArgs(argv, { sig: "value", trust: "list", build: "value", product: "value", compatible: "value", device: "value",
                                "last-counter": "value", key: "value", help: "bool" });
    if (a.help) { out.log(USAGE); return 0; }
    if (a._.length !== 1) throw new UsageError("nova verify BUNDLE --build ID --product LINE");
    if (!a.build || !a.product) throw new UsageError("nova verify needs --build and --product (the device's)");
    const bundle = require("./lib/bundle.cjs");
    const file = a._[0];
    const sigFile = a.sig || file + ".sig";
    const trust = (a.trust || []).map((k) => ({ key: trustKey(k), kind: "paired" }));
    if (!trust.length) trust.push({ key: require("./lib/keys.cjs").load(a.key, false).publicKey, kind: "paired" });
    try {
        const r = await bundle.verifyBundle(fs.readFileSync(file), fs.readFileSync(sigFile, "utf8"), {
            trust, device: { build: a.build, product: a.product, compatible: a.compatible || null, id: a.device || null },
            lastCounter: () => Number(a["last-counter"] || 0),
        });
        out.log(`OK: ${r.manifest.id}, ${r.files.length} files, ${r.manifest.removed.length} removed; restarts: ${r.restart.join(", ")}`);
        return 0;
    } catch (e) {
        if (!e.code) throw e;
        out.err(`${e.code}: ${e.message}`);
        return 1;
    }
}

function cmdKey(argv, out) {
    const a = parseArgs(argv, { key: "value", help: "bool" });
    if (a.help) { out.log(USAGE); return 0; }
    const key = require("./lib/keys.cjs").load(a.key);
    out.log(`${key.id}\n${key.fingerprint}\n${key.file}${key.made ? " (made now)" : ""}`);
    return 0;
}

// argv (after "nova") -> exit code. out: {log, err}.
async function main(argv, out) {
    out = out || { log: (t) => console.log(t), err: (t) => console.error(t) };
    const [cmd, ...rest] = argv;
    try {
        if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") { out.log(USAGE); return cmd ? 0 : 2; }
        if (cmd === "package") return await cmdPackage(rest, out);
        if (cmd === "verify") return await cmdVerify(rest, out);
        if (cmd === "key") return cmdKey(rest, out);
        if (LATER.includes(cmd)) { out.err(`nova ${cmd}: not built yet (docs/DEV-PUSH.md section 12, P2 and later)`); return 2; }
        throw new UsageError("unknown command " + cmd);
    } catch (e) {
        if (e instanceof UsageError) { out.err("nova: " + e.message + " (nova --help)"); return 2; }
        if (e.code) { out.err(`nova: ${e.message}`); return 1; }
        throw e;
    }
}

module.exports = { main, parseArgs };

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e); process.exitCode = 1; });
}
