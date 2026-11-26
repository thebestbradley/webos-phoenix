// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The bundle maker (docs/DEV-PUSH.md 8) and nova's packages:
//
//   makeSystemBundle(opts)  a dev bundle of what differs between the
//                           checkout's file plan (tools/install-rootfs.py,
//                           the shell's QML and assets included) and an
//                           image's manifest.json: changed and new files,
//                           and image files the checkout no longer
//                           installs; signed with the computer's key
//   packageApp(dir)         an app's .ipk, as palm-package made one
//   verifyBundle(...)       the device's checks (devpush.js verify), here
//
// The format and its checks are @phoenix/platform's devpush.js, shared with
// the device; the .ipk reader and writer the Marketplace's lib/ipk.js.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "../../..");
const devpush = require(path.join(REPO, "apps/shared/platform/src/devpush.js"));
const ipkLib = require(path.join(REPO, "apps/marketplace/service/lib/ipk.js"));

const RULES = devpush.RULES;

function fail(code, text, extra) {
    return Object.assign(new Error(text), { code }, extra || {});
}

// gzip whose bytes do not depend on the computer: zlib writes no time, and
// the header's OS byte is set to Unix's (3) on every system, so the same
// files make the same bundle on a Mac and on Linux.
const gzip = {
    gzip: async (bytes) => {
        const out = zlib.gzipSync(bytes, { level: 9 });
        out[9] = 3;
        return new Uint8Array(out);
    },
    gunzip: async (bytes) => new Uint8Array(zlib.gunzipSync(bytes, { maxOutputLength: RULES.maxUnpackedBytes + (1 << 20) })),
};
const ipk = ipkLib.createIpk({ gzip });

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sha512 = async (bytes) => new Uint8Array(crypto.createHash("sha512").update(bytes).digest());

// ---- Manifests ---------------------------------------------------------------------------

function python() {
    return process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
}

function runInstallRootfs(repo, args, input) {
    // This checkout's planner, run on the checkout the bundle is made from.
    const script = path.join(REPO, "tools", "install-rootfs.py");
    const r = spawnSync(python(), [script, "--repo", repo].concat(args), { input, maxBuffer: 1 << 30 });
    if (r.error) throw fail("NO_PYTHON", "Could not run " + python() + " (" + r.error.message + "): the bundle maker uses tools/install-rootfs.py");
    if (r.status !== 0) throw fail("PLAN_FAILED", "tools/install-rootfs.py " + args[0] + ": " + String(r.stderr).trim());
    return r.stdout;
}

// The checkout's manifest: what an image built from it would hold.
function repoManifest(repo) {
    return JSON.parse(runInstallRootfs(repo, ["--print-manifest"]).toString("utf8"));
}

// An image's manifest.json (from the device, the server, or a file), checked.
function readImageManifest(file) {
    let m;
    try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw fail("BAD_MANIFEST", file + ": " + e.message); }
    const problems = checkImageManifest(m);
    if (problems.length) throw fail("BAD_MANIFEST", file + ": " + problems[0], { problems });
    return m;
}

// /usr/share/phoenix/manifest.json -> [problems] (docs/platform-api/
// devpush.schema.json, imageManifest).
function checkImageManifest(m) {
    const out = [];
    if (!m || typeof m !== "object") return ["not an object"];
    if (m.format !== 1) out.push("format: not 1");
    if (typeof m.build !== "string" || !m.build) out.push("build: missing");
    if (!m.product || typeof m.product.line !== "string" || !/^\d+\.\d+$/.test(m.product.line)) out.push("product.line: not a product line such as 1.0");
    if (!Array.isArray(m.files)) return out.concat("files: not a list");
    let last = "";
    m.files.forEach((f, i) => {
        if (!f || typeof f.path !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256 || "") || !Number.isSafeInteger(f.size) || !/^0[0-7]{3}$/.test(f.mode || "")) {
            out.push("files[" + i + "]: not {path, size, sha256, mode}");
        } else if (f.path <= last) out.push("files[" + i + "]: " + f.path + " out of order or twice");
        else last = f.path;
    });
    return out;
}

function byPath(m) {
    const out = new Map();
    for (const f of m.files) out.set(f.path, f);
    return out;
}

// ---- What changed in the compiled parts (section 10) -------------------------------------

// Checkout folders built into binaries that changed since the image's
// commit: [paths], or null when that cannot be told (no commit in the
// manifest, or not in this checkout).
function compiledChanges(repo, image) {
    const commit = image.source && image.source.commit;
    if (!commit || !/^[0-9a-f]{7,64}$/.test(commit)) return null;
    const git = (args) => spawnSync("git", ["-C", repo].concat(args), { encoding: "utf8" });
    const diff = git(["diff", "--name-only", commit, "--"].concat(RULES.compiled));
    if (diff.status !== 0) return null;
    const untracked = git(["ls-files", "--others", "--exclude-standard", "--"].concat(RULES.compiled));
    return diff.stdout.split("\n").concat(untracked.status === 0 ? untracked.stdout.split("\n") : []).filter(Boolean).sort();
}

// ---- The difference ------------------------------------------------------------------------

// The checkout's manifest against the image's -> {files: [repo entries
// changed or new], removed: [paths], refused: [paths left out], newApps}.
// mode "add": nothing is removed. only: device path prefixes to limit it to.
function difference(repo, image, opts) {
    const theirs = byPath(image);
    const ours = byPath(repo);
    const only = (opts && opts.only) || [];
    const within = (p) => !only.length || only.some((o) => p === o || p.startsWith(o.replace(/\/?$/, "/")));
    const files = [], removed = [], refused = [];
    for (const [p, f] of ours) {
        if (!within(p)) continue;
        const t = theirs.get(p);
        if (t && t.sha256 === f.sha256 && t.mode === f.mode) continue;
        if (devpush.pathProblem(p)) { refused.push(p); continue; }
        files.push(f);
    }
    if (!opts || opts.mode !== "add") {
        for (const p of theirs.keys()) {
            if (ours.has(p) || !within(p)) continue;
            if (devpush.pathProblem(p)) { refused.push(p); continue; }
            removed.push(p);
        }
    }
    return { files, removed: removed.sort(), refused: refused.sort() };
}

// ---- Making a dev bundle ----------------------------------------------------------------------

function canonical(v) {
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
    return JSON.stringify(v);
}

function madeTime(opts) {
    if (opts.made) {
        const t = Date.parse(opts.made);
        if (!(t > 0)) throw fail("BAD_PARAMS", "--made: not a time: " + opts.made);
        return new Date(t);
    }
    if (process.env.SOURCE_DATE_EPOCH && /^\d+$/.test(process.env.SOURCE_DATE_EPOCH)) return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000);
    return new Date();
}

// opts: {repo, manifest (the image's, parsed), key (keys.load), device
// ("any" | id), compatible (null: the manifest's), mode ("replace" |
// "add"), note, counter, made, only: [device path prefixes],
// allowCompiled, log(text)} -> {bytes, signature, manifest, refused,
// compiled} | {nothing: true, refused}
async function makeSystemBundle(opts) {
    const log = opts.log || (() => {});
    const repo = opts.repo || REPO;
    const image = opts.manifest;
    if (["unstamped", "checkout"].includes(image.build)) {
        throw fail("UNSTAMPED", "The image's manifest has no build id (\"" + image.build + "\"): an image stamps it at build time (tools/install-rootfs.py --stamp)");
    }
    const compiled = compiledChanges(repo, image);
    if (compiled === null) log("warning: cannot tell whether compiled parts changed since the image (its manifest names no commit this checkout has)");
    else if (compiled.length && !opts.allowCompiled) {
        throw fail("NEEDS_IMAGE", compiled[0].split("/").slice(0, 2).join("/") + " changed: this needs a new image (" + compiled.join(", ") + ")", { compiled });
    }
    const ours = repoManifest(repo);
    if (ours.product.line !== image.product.line) {
        throw fail("WRONG_PRODUCT", "This checkout is webOS Phoenix " + ours.product.line + "; the image is " + image.product.line);
    }
    if (ours.unbuilt && ours.unbuilt.length) {
        throw fail("NOT_BUILT", "Build first: " + ours.unbuilt[0] + (ours.unbuilt.length > 1 ? " (and " + (ours.unbuilt.length - 1) + " more)" : ""));
    }
    const mode = opts.mode || "replace";
    const diff = difference(ours, image, { mode, only: opts.only });
    for (const p of diff.refused) log("warning: left out, never changed by a bundle: " + p);
    if (!diff.files.length && !diff.removed.length) return { nothing: true, refused: diff.refused };

    // The changed files' bytes, as the image would have them.
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "nova-stage-"));
    let data;
    try {
        runInstallRootfs(repo, [stage, "--only", "-"], diff.files.map((f) => f.path).join("\n") + "\n");
        data = diff.files.map((f) => {
            const bytes = fs.readFileSync(path.join(stage, f.path.slice(1)));
            if (sha256(bytes) !== f.sha256) throw fail("PLAN_FAILED", f.path + " changed while the bundle was made; try again");
            return { path: f.path, data: new Uint8Array(bytes), mode: parseInt(f.mode, 8) };
        });
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }

    const made = madeTime(opts);
    const paths = diff.files.map((f) => f.path).concat(diff.removed);
    const m = {
        format: devpush.FORMAT,
        id: "",
        made: made.toISOString().replace(/\.\d+Z$/, "Z"),
        build: image.build,
        product: image.product.line,
        compatible: opts.compatible !== undefined && opts.compatible !== null ? opts.compatible : (image.compatible || null),
        device: opts.device || "any",
        counter: opts.counter !== undefined && opts.counter !== null ? Number(opts.counter) : made.getTime(),
        mode,
        parts: devpush.partsFor(paths),
        files: diff.files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.size, mode: f.mode })),
        removed: diff.removed,
        restart: devpush.restartsFor(paths),
    };
    if (ours.source) m.source = ours.source;
    if (opts.note) m.note = String(opts.note).slice(0, 500);
    m.by = opts.key.id;
    const rest = Object.assign({}, m);
    delete rest.id;
    m.id = sha256(canonical(rest)).slice(0, 32);
    // The same order every time: id first after format, as written above.
    const problems = devpush.checkManifest(m);
    if (problems.length) throw fail("BAD_BUNDLE", "The bundle would not be valid: " + problems[0], { problems });

    const bytes = await writeBundle(m, data);
    if (bytes.length > RULES.maxBundleBytes) {
        throw fail("TOO_BIG", "The bundle is " + bytes.length + " bytes; the most is 64 MB (" + RULES.maxBundleBytes + "). Push fewer parts (--only)");
    }
    const keys = require("./keys.cjs");
    return { bytes, signature: keys.signDetached(bytes, opts.key), manifest: m, refused: diff.refused, compiled: compiled || [] };
}

// devpush.json and the files -> the .ipk's bytes (no signature).
function writeBundle(m, files) {
    const version = m.made.replace(/\D/g, "").slice(0, 14);
    return ipk.write({
        control: { Package: "phoenix-devpush", Version: version, Architecture: "all",
                   Description: (m.note || "Developer changes").replace(/\n/g, " ") },
        controlFiles: [{ path: "devpush.json", data: JSON.stringify(m, null, 1) + "\n" }],
        files: files.slice().sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => ({ path: f.path.slice(1), data: f.data, mode: f.mode })),
    }).then((b) => Buffer.from(b));
}

// ---- Checking one, as the device would ---------------------------------------------------

function verifyBundle(bytes, signature, opts) {
    return devpush.verify(new Uint8Array(bytes), signature, Object.assign({ readIpk: ipk.read, sha256, sha512 }, opts));
}

// ---- An app's .ipk (palm-package) ----------------------------------------------------------

const APP_SKIP = new Set([".git", ".gitignore", "node_modules", ".DS_Store", "Thumbs.db"]);

// dir -> {name (<id>_<version>_all.ipk), bytes, appinfo, files}
async function packageApp(dir) {
    let info;
    try { info = JSON.parse(fs.readFileSync(path.join(dir, "appinfo.json"), "utf8").replace(/^﻿/, "")); } catch (e) {
        throw fail("BAD_APP", dir + ": no appinfo.json it can read (" + e.message + ")");
    }
    if (typeof info.id !== "string" || !/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/.test(info.id)) throw fail("BAD_APP", "appinfo.json: id is not an app id");
    const version = typeof info.version === "string" && /^\d+(\.\d+){0,2}$/.test(info.version) ? info.version : null;
    if (!version) throw fail("BAD_APP", "appinfo.json: version is not N.N.N");
    const files = [];
    (function walk(d, rel) {
        for (const name of fs.readdirSync(d).sort()) {
            if (APP_SKIP.has(name)) continue;
            const full = path.join(d, name);
            const st = fs.lstatSync(full);
            if (st.isSymbolicLink()) throw fail("BAD_APP", "A link in the app: " + path.join(rel, name));
            if (st.isDirectory()) walk(full, rel + name + "/");
            else if (st.isFile()) files.push({ path: "usr/palm/applications/" + info.id + "/" + rel + name, data: new Uint8Array(fs.readFileSync(full)), mode: st.mode & 0o111 ? 0o755 : 0o644 });
        }
    })(dir, "");
    const bytes = Buffer.from(await ipk.write({
        control: { Package: info.id, Version: version, Architecture: "all", Description: info.title || info.id,
                   Maintainer: info.vendor ? String(info.vendor) : undefined },
        files,
    }));
    return { name: info.id + "_" + version + "_all.ipk", bytes, appinfo: info, files: files.length };
}

module.exports = { REPO, ipk, gzip, sha256, sha512, repoManifest, readImageManifest, checkImageManifest, difference,
                   compiledChanges, makeSystemBundle, writeBundle, verifyBundle, packageApp, canonical };
