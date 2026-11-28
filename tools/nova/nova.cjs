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
// Built: package, verify, key (P1); pair, unpair, devices, push, put, get,
// status, revert, restart, rescan, log, luna-send, forward, term (P2,
// lib/remote.cjs, talking to the device's novad: services/nova); install.
// To come (docs/DEV-PUSH.md 12): install -r, launch, send, generate, inspect.

"use strict";

const fs = require("fs");
const path = require("path");

// The device's protocol (services/nova) needs @noble/curves, from the
// checkout's apps/node_modules (./phoenix installs it), as Node would
// find it with NODE_PATH.
(function nodePath() {
    const Module = require("module");
    const nm = path.resolve(__dirname, "../../apps/node_modules");
    const paths = (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
    if (!paths.includes(nm)) {
        process.env.NODE_PATH = [nm].concat(paths).join(path.delimiter);
        Module._initPaths();
    }
})();

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

With a device (Developer Mode on; TLS on port 6965, both keys pinned):

  nova pair [ADDRESS] [--code CODE] [--as NAME] [--name COMPUTER]
      Pair with the device at ADDRESS (or -d usb, -d sim): type the six-digit
      code it shows in Settings > Developer Mode > Pair a Computer
  nova unpair DEVICE              Forget it, here and on the device
  nova devices                    Paired devices and whether they answer
  nova push [--add] [--dry-run] [--note TEXT] [--allow-compiled] [PATHS...]
      Build a dev bundle of what this checkout changes against the device's
      image and apply it; it restarts only what changed. PATHS: only those
      (repository paths such as shell/qml or apps/settings, or device paths)
  nova put DEVICEPATH FILE        One file into the device's overlay
  nova get DEVICEPATH [FILE]      One file from the device (its five overlay folders)
  nova status [--json]            What the overlay holds
  nova revert [DEVICEPATH]        One file back to the image's; without one,
                                  Revert to Image (the device restarts)
  nova restart shell|wam|app ID|service ID
  nova rescan                     Pick up new or changed apps (Palm's rescan)
  nova install IPK                Install an app's .ipk (nova package): a new
                                  app, or an update of one this computer
                                  installed; never a built-in app or one
                                  from another publisher (remove it first)
  nova log [-f] [ID]              The device's journal, for an app, service or unit
  nova luna-send URI [JSON]       One Luna call on the device
  nova forward PORT [--local N]   A local port reaching the device's 9998
                                  (Web Inspector), 3768 (QML debugger) or 22
  nova term [COMMAND]             SSH to the device as user, with the paired key

  -d, --device NAME|usb|sim[:INSTANCE]|ADDRESS   which device (default: the
      only one paired, else the last used)
  Every command: --key FILE (default ~/.config/nova/key), -h/--help

Still to come (docs/DEV-PUSH.md 12): install -r, launch, send, generate, inspect.`;

const LATER = ["launch", "send", "generate", "inspect"];

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
        if (name === "f") name = "follow";
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

// The commands that talk to a device: lib/remote.cjs's function, options.
const REMOTE = {
    pair: ["pair", { code: "value", as: "value", name: "value" }],
    unpair: ["unpair", {}],
    devices: ["listDevices", {}],
    push: ["push", { add: "bool", "dry-run": "bool", note: "value", "allow-compiled": "bool", repo: "value" }],
    put: ["put", { note: "value" }],
    get: ["get", {}],
    status: ["status", { json: "bool" }],
    revert: ["revert", {}],
    restart: ["restart", {}],
    rescan: ["rescan", {}],
    install: ["install", {}],
    log: ["log", { follow: "bool" }],
    "luna-send": ["lunaSend", {}],
    forward: ["forward", { local: "value", once: "bool" }],
    term: ["term", { ssh: "value" }],
};

// argv (after "nova") -> exit code. out: {log, err, write (bytes to stdout)}.
async function main(argv, out) {
    out = out || { log: (t) => console.log(t), err: (t) => console.error(t), write: (b) => process.stdout.write(b) };
    const [cmd, ...rest] = argv;
    try {
        if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") { out.log(USAGE); return cmd ? 0 : 2; }
        if (cmd === "package") return await cmdPackage(rest, out);
        if (cmd === "verify") return await cmdVerify(rest, out);
        if (cmd === "key") return cmdKey(rest, out);
        if (REMOTE[cmd]) {
            const a = parseArgs(rest, Object.assign({ device: "value", key: "value", help: "bool" }, REMOTE[cmd][1]));
            if (a.help) { out.log(USAGE); return 0; }
            return await require("./lib/remote.cjs")[REMOTE[cmd][0]](a, out);
        }
        if (LATER.includes(cmd)) { out.err(`nova ${cmd}: not built yet (docs/DEV-PUSH.md section 12, P2 and later)`); return 2; }
        throw new UsageError("unknown command " + cmd);
    } catch (e) {
        if (e instanceof UsageError || e.code === "USAGE") { out.err("nova: " + e.message + " (nova --help)"); return 2; }
        if (e.code) { out.err(`nova: ${e.message}`); return 1; }
        throw e;
    }
}

module.exports = { main, parseArgs };

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e); process.exitCode = 1; });
}
