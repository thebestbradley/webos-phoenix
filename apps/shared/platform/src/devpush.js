// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dev bundles (docs/DEV-PUSH.md 5): changed system files for a test device
// in Developer Mode, laid into its developer overlay. One reader for every
// side: the nova command (tools/nova) checks what it made with it, the
// device's org.webosphoenix.nova checks what it is sent, and
// Phoenix-Web-Services follows the same rules (docs/platform-api/
// devpush.schema.json). Plain CommonJS without dependencies.
//
// A dev bundle is an .ipk (an ar archive of debian-binary, control.tar.gz
// and data.tar.gz, apps/marketplace/service/lib/ipk.js):
//
//   control.tar.gz   ./control (Package: phoenix-devpush, ...) and
//                    ./devpush.json, the manifest of the changes (below)
//   data.tar.gz      the files at their device paths, regular files only,
//                    mode 0644 or 0755
//
// and beside it <bundle>.ipk.sig: base64 of the Ed25519 signature of the
// .ipk's exact bytes, then a newline, the detached form of every Phoenix
// feed (signed.js; docs/PLATFORM-CLIENT.md "Signatures and keys"), by the
// key devpush.json names in "by".
//
// devpush.json (format 1):
//   {"format": 1, "id": "<32 hex>", "made": "<ISO time>",
//    "build": "<the image's BUILD_ID>", "product": "1.0" (the product line,
//    product.json's major version: 2.0 devices take no 1.0 bundles),
//    "compatible": "<RAUC compatible>" | null (any device of that build),
//    "device": "<device id>" | "any", "counter": <integer>,
//    "mode": "replace" | "add", "parts": ["apps", "roles", "services", "shell"],
//    "files": [{"path", "sha256", "size", "mode": "0644" | "0755"}],
//    "removed": ["<path>"], "restart": ["shell", "app:<id>", ...],
//    "source": {"repo", "commit", "dirty"}?, "note"?, "by": "ed25519:<base64 key>"}
//
// "counter" (9.1, no replay): the device keeps the last counter it applied
// per grant (per key for its paired computers and the platform's key) and
// refuses one at or below it; nova makes it from the time the bundle was
// made, in milliseconds, so it needs no state on the computer.

"use strict";

var signed = require("./signed");
var b64 = require("./b64");
var RULES = require("./devpush-paths.json");

var FORMAT = 1;
var PARTS = ["apps", "roles", "services", "shell"];
var REFUSED_RE = RULES.refusedPatterns.map(function (p) { return new RegExp(p); });

function fail(code, text, extra) {
    var e = new Error(text);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
}

// ---- Paths --------------------------------------------------------------------------

// A device path written as a bundle may carry it: absolute, no "." or ".."
// segments, no empty ones, no trailing "/", only plain characters.
function wellFormed(path) {
    if (typeof path !== "string" || path.length < 2 || path.length > 1024 || path[0] !== "/") return false;
    if (!/^[A-Za-z0-9._@+,=~ \/-]+$/.test(path)) return false;
    return path.slice(1).split("/").every(function (s) { return s && s !== "." && s !== ".." && !/\.nova-new$/.test(s); });
}

function mountOf(path) {
    for (var i = 0; i < RULES.mounts.length; i++) {
        if (path.indexOf(RULES.mounts[i] + "/") === 0) return RULES.mounts[i];
    }
    return null;
}

function refused(path) {
    for (var i = 0; i < RULES.refused.length; i++) {
        var r = RULES.refused[i];
        if (r[r.length - 1] === "/" ? path.indexOf(r) === 0 : path === r) return true;
    }
    return REFUSED_RE.some(function (re) { return re.test(path); });
}

// path -> null when a bundle may change it, else why not.
function pathProblem(path) {
    if (!wellFormed(path)) return "not a plain absolute path";
    if (!mountOf(path)) return "outside the developer overlay (" + RULES.mounts.join(", ") + ")";
    if (refused(path)) return "never changed by a bundle (docs/DEV-PUSH.md 9.4)";
    return null;
}

function overlayable(path) { return pathProblem(path) === null; }

function partOf(path) {
    for (var i = 0; i < RULES.parts.length; i++) {
        if (path.indexOf(RULES.parts[i][0]) === 0) return RULES.parts[i][1];
    }
    return null;
}

// ---- The restart map (docs/DEV-PUSH.md 4.5) -------------------------------------------

var APP_RE = /^\/usr\/palm\/applications\/([^/]+)\//;
var SERVICE_RE = /^\/usr\/palm\/services\/([^/]+)\//;
var ORDER = ["hub", "configurator", "rescan", "service", "app", "wam", "shell", "reboot"];

// The restarts for the paths a bundle changes or removes: "hub" (the Luna
// hub's tables, ls-control scan-services), "configurator" (db8 kinds,
// activities), "rescan" (the application manager's, when an appinfo.json is
// new, changed or gone), "service:<id>", "app:<id>", "wam" (WebAppMgr: the
// runtime and frameworks every page loads), "shell" (luna-surfacemanager)
// and "reboot" (nothing restarts it live: "Restart the device to finish").
// Narrowest first, each once. The device works this out itself; a
// bundle's list is what its maker expects, shown to the owner.
function restartsFor(paths) {
    var out = {};
    function add(r) { out[r] = true; }
    (paths || []).forEach(function (p) {
        var m;
        if (/^\/usr\/share\/phoenix\/(qml|assets)\//.test(p)) add("shell");
        else if (/^\/usr\/share\/phoenix\/runtime\//.test(p) || /^\/usr\/palm\/frameworks\//.test(p) || /^\/usr\/lib\/luna\//.test(p)) add("wam");
        else if ((m = APP_RE.exec(p))) {
            add("app:" + m[1]);
            if (p === "/usr/palm/applications/" + m[1] + "/appinfo.json") add("rescan");
        } else if ((m = SERVICE_RE.exec(p))) add("service:" + m[1]);
        else if (/^\/usr\/share\/luna-service2\//.test(p)) add("hub");
        else if (/^\/etc\/palm\/(db|tempdb|activities)\//.test(p)) add("configurator");
        else add("reboot");
    });
    return Object.keys(out).sort(function (a, b) {
        var d = ORDER.indexOf(a.split(":")[0]) - ORDER.indexOf(b.split(":")[0]);
        return d || (a < b ? -1 : a > b ? 1 : 0);
    });
}

function partsFor(paths) {
    var out = {};
    (paths || []).forEach(function (p) { var part = partOf(p); if (part) out[part] = true; });
    return PARTS.filter(function (p) { return out[p]; });
}

// ---- devpush.json ---------------------------------------------------------------------

var HEX64 = /^[0-9a-f]{64}$/;
var KEY_RE = /^ed25519:[A-Za-z0-9+/]{43}=$/;
var TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
var TOKEN_RE = /^[A-Za-z0-9._:+-]{1,128}$/;

function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

// A devpush.json -> [problems] ([] when it is well formed). What it checks
// is the shape and the paths; who signed it and for which device is
// verify()'s.
function checkManifest(m) {
    var out = [];
    function bad(s) { out.push(s); }
    if (!isObj(m)) return ["devpush.json is not an object"];
    if (m.format !== FORMAT) bad("format: not " + FORMAT);
    if (typeof m.id !== "string" || !/^[0-9a-f]{32}$/.test(m.id)) bad("id: not 32 hex digits");
    if (typeof m.made !== "string" || !TIME_RE.test(m.made)) bad("made: not a UTC time");
    if (typeof m.build !== "string" || !TOKEN_RE.test(m.build)) bad("build: not a build id");
    if (typeof m.product !== "string" || !/^\d+\.\d+$/.test(m.product)) bad("product: not a product line such as 1.0");
    if (m.compatible !== null && (typeof m.compatible !== "string" || !TOKEN_RE.test(m.compatible))) bad("compatible: not a name or null");
    if (typeof m.device !== "string" || !TOKEN_RE.test(m.device)) bad("device: not a device id or \"any\"");
    if (typeof m.counter !== "number" || !Number.isSafeInteger(m.counter) || m.counter < 1) bad("counter: not a positive integer");
    if (m.mode !== "replace" && m.mode !== "add") bad("mode: not replace or add");
    if (typeof m.by !== "string" || !KEY_RE.test(m.by)) bad("by: not ed25519:<base64 public key>");
    if (m.note !== undefined && (typeof m.note !== "string" || m.note.length > 500)) bad("note: not a text of at most 500 characters");
    if (m.source !== undefined && !isObj(m.source)) bad("source: not an object");
    if (!Array.isArray(m.files)) bad("files: not a list");
    if (!Array.isArray(m.removed)) bad("removed: not a list");
    if (!Array.isArray(m.restart) || !m.restart.every(function (r) { return typeof r === "string" && /^(hub|configurator|rescan|wam|shell|reboot|app:[^/\s]+|service:[^/\s]+)$/.test(r); })) bad("restart: not a list of restarts");
    if (!Array.isArray(m.parts) || !m.parts.every(function (p) { return PARTS.indexOf(p) >= 0; })) bad("parts: not a list of " + PARTS.join(", "));
    if (out.length) return out;
    var seen = {};
    m.files.forEach(function (f, i) {
        var at = "files[" + i + "]";
        if (!isObj(f)) return bad(at + ": not an object");
        if (typeof f.path !== "string") return bad(at + ".path: missing");
        var why = pathProblem(f.path);
        if (why) bad(at + ": " + f.path + ": " + why);
        if (seen[f.path]) bad(at + ": " + f.path + " twice");
        seen[f.path] = true;
        if (typeof f.sha256 !== "string" || !HEX64.test(f.sha256)) bad(at + ".sha256: not 64 hex digits");
        if (typeof f.size !== "number" || !Number.isSafeInteger(f.size) || f.size < 0) bad(at + ".size: not a size");
        if (f.mode !== "0644" && f.mode !== "0755") bad(at + ".mode: not 0644 or 0755");
    });
    m.removed.forEach(function (p, i) {
        var why = typeof p === "string" ? pathProblem(p) : "not a path";
        if (why) bad("removed[" + i + "]: " + p + ": " + why);
        if (seen[p]) bad("removed[" + i + "]: " + p + " is also in files");
        seen[p] = true;
    });
    if (!m.files.length && !m.removed.length) bad("the bundle changes nothing");
    var need = partsFor(m.files.map(function (f) { return f.path; }).concat(m.removed));
    if (need.join() !== m.parts.slice().sort().join()) bad("parts: " + m.parts.join(", ") + ", but its paths are " + need.join(", "));
    return out;
}

// The paths' problems as one error: REFUSED_PATH when any path is outside
// the overlay or refused, else BAD_BUNDLE.
function manifestError(problems) {
    var refusedOne = problems.filter(function (p) { return /outside the developer overlay|never changed by a bundle|not a plain absolute path/.test(p); });
    if (refusedOne.length) return fail("REFUSED_PATH", "The bundle changes a file it may not: " + refusedOne[0], { problems: problems });
    return fail("BAD_BUNDLE", "The bundle's devpush.json is not valid: " + problems[0], { problems: problems });
}

// ---- Checking a bundle (docs/DEV-PUSH.md 5.3) --------------------------------------------

function toHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
}
function fromUtf8(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString("utf8");
}

// bytes (the .ipk), signature (the .sig's text), opts -> Promise<{manifest,
// files: [{path (device path), mode, data}], trust (the entry of opts.trust
// that signed it), restart (restartsFor its paths)}>, or rejects with an
// Error whose code says why, in the order the device checks them:
//
//   TOO_BIG        over 64 MB (maxBundleBytes)
//   NEEDS_DEVMODE  opts.devMode is false
//   UNTRUSTED      no key in opts.trust signed these bytes, its grant
//                  expired or was revoked, or "by" is not the key that signed
//   NOT_A_BUNDLE   not an .ipk, or no devpush.json
//   BAD_BUNDLE     devpush.json is not valid; a file's size, SHA-256 or
//                  mode differs from it; a file it does not list, a link or
//                  a special file; unpacks to more than maxUnpackedBytes
//   WRONG_BUILD, WRONG_PRODUCT, WRONG_DEVICE   not for this device's image
//   REPLAY         counter at or below the last one applied (9.1)
//   REFUSED_PATH   a path outside the overlay or never overlayable (9.4)
//   OUT_OF_SCOPE   a part the key's grant does not allow (9.1)
//   NO_SPACE       opts.spaceLeft is given and the files do not fit
//
// The signature is checked before anything in the bundle is unpacked.
// opts:
//   trust: [{key: base64, kind: "master" | "paired" | "grant",
//            grant?: {id, devices: [ids], product, parts: [..], expires: ISO,
//                     revoked?: bool}}]
//   device: {build, product, compatible, id}   the running image's
//   lastCounter(scope) -> number | Promise   scope: "grant:<id>" or "key:<base64>"
//   readIpk(bytes) -> Promise<ipk.read()'s result>   (createIpk(...).read)
//   sha256(bytes) -> Promise<hex> | hex;  sha512(bytes) -> Promise<Uint8Array>
//   devMode?: bool;  spaceLeft?: bytes;  now?: Date
function verify(bytes, signatureB64, opts) {
    var trust = (opts && opts.trust) || [];
    var now = (opts.now || new Date()).getTime();
    if (bytes.length > RULES.maxBundleBytes) {
        return Promise.reject(fail("TOO_BIG", "The bundle is " + bytes.length + " bytes; the most is " + RULES.maxBundleBytes + " (64 MB)"));
    }
    if (opts.devMode === false) return Promise.reject(fail("NEEDS_DEVMODE", "Developer Mode is off"));
    var keys = trust.map(function (t) { return t.key; });
    var found, manifest, pkg;
    return signed.verifyWithAny(bytes, signatureB64, keys, opts.sha512, "dev bundle").then(function (key) {
        found = trust.filter(function (t) { return t.key === key; })[0];
        var g = found.grant;
        if (found.kind === "grant") {
            if (!g) throw fail("UNTRUSTED", "The key's grant is missing");
            if (g.revoked) throw fail("UNTRUSTED", "The grant " + g.id + " was revoked");
            if (!(Date.parse(g.expires) > now)) throw fail("UNTRUSTED", "The grant " + g.id + " expired on " + g.expires);
        }
    }, function (e) {
        throw fail("UNTRUSTED", keys.length ? "The bundle is not signed by a key this device trusts for bundles" : "This device trusts no key for bundles", { cause: e.code });
    }).then(function () {
        return Promise.resolve(opts.readIpk(bytes)).then(null, function (e) {
            throw fail(e.code === "BAD_APPINFO" ? "BAD_BUNDLE" : "NOT_A_BUNDLE", "Not a dev bundle: " + e.message);
        });
    }).then(function (p) {
        pkg = p;
        var mf = (pkg.controlFiles || []).filter(function (f) { return f.path === "devpush.json"; })[0];
        if (!mf || pkg.control.Package !== "phoenix-devpush") throw fail("NOT_A_BUNDLE", "Not a dev bundle (no devpush.json)");
        try { manifest = JSON.parse(fromUtf8(mf.data)); } catch (e) { throw fail("BAD_BUNDLE", "devpush.json is not JSON"); }
        var shape = checkManifest(manifest).filter(function (p) { return !/^files\[|^removed\[|^parts:|changes nothing/.test(p); });
        if (shape.length) throw manifestError(shape);
        if (manifest.by !== "ed25519:" + b64.toBase64(b64.fromBase64(found.key))) {
            throw fail("UNTRUSTED", "The bundle names a key (\"by\") other than the one that signed it");
        }
        var dev = opts.device || {};
        if (manifest.build !== dev.build) throw fail("WRONG_BUILD", "The bundle is for build " + manifest.build + "; this device runs " + dev.build);
        if (manifest.product !== dev.product) throw fail("WRONG_PRODUCT", "The bundle is for webOS Phoenix " + manifest.product + "; this device runs " + dev.product);
        if (manifest.compatible !== null && manifest.compatible !== dev.compatible) throw fail("WRONG_DEVICE", "The bundle is for " + manifest.compatible + " devices");
        var g = found.kind === "grant" ? found.grant : null;
        if (manifest.device !== "any" ? manifest.device !== dev.id : !!g) {
            throw fail("WRONG_DEVICE", g && manifest.device === "any" ? "A bundle from a granted key must name the device" : "The bundle is for another device");
        }
        if (g && (g.devices || []).indexOf(dev.id) < 0) throw fail("OUT_OF_SCOPE", "The grant " + g.id + " does not cover this device");
        if (g && g.product !== dev.product) throw fail("OUT_OF_SCOPE", "The grant " + g.id + " is for webOS Phoenix " + g.product);
        var scope = g ? "grant:" + g.id : "key:" + found.key;
        return Promise.resolve(opts.lastCounter ? opts.lastCounter(scope) : 0).then(function (last) {
            if (manifest.counter <= (last || 0)) throw fail("REPLAY", "The bundle's counter " + manifest.counter + " is not above the last one applied (" + last + ")");
            var all = checkManifest(manifest);
            if (all.length) throw manifestError(all);
            if (g) {
                var outside = manifest.parts.filter(function (p) { return (g.parts || []).indexOf(p) < 0; });
                if (outside.length) throw fail("OUT_OF_SCOPE", "The grant " + g.id + " does not allow changes to " + outside.join(", "));
            }
            return checkFiles(manifest, pkg, opts);
        });
    }).then(function (files) {
        var size = files.reduce(function (n, f) { return n + f.data.length; }, 0);
        if (typeof opts.spaceLeft === "number" && size > opts.spaceLeft) throw fail("NO_SPACE", "The bundle's files need " + size + " bytes; the overlay has " + opts.spaceLeft + " left");
        return { manifest: manifest, files: files, trust: found,
                 restart: restartsFor(manifest.files.map(function (f) { return f.path; }).concat(manifest.removed)) };
    });
}

// Every data entry is a listed regular file with its listed size, mode and
// SHA-256, and every listed file is there.
function checkFiles(manifest, pkg, opts) {
    var listed = {};
    manifest.files.forEach(function (f) { listed[f.path] = f; });
    var total = 0, got = {};
    var entries = pkg.entries || pkg.files;
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.dir) continue;
        var path = "/" + e.path;
        if (e.link !== undefined) return Promise.reject(fail("BAD_BUNDLE", "The bundle holds a link: " + path));
        if (e.special !== undefined || !e.data) return Promise.reject(fail("BAD_BUNDLE", "The bundle holds a special file: " + path));
        var f = listed[path];
        if (!f) return Promise.reject(fail("BAD_BUNDLE", "The bundle holds a file devpush.json does not list: " + path));
        if (got[path]) return Promise.reject(fail("BAD_BUNDLE", "The bundle holds " + path + " twice"));
        if (e.data.length !== f.size) return Promise.reject(fail("BAD_BUNDLE", path + ": " + e.data.length + " bytes, not " + f.size));
        if (e.mode !== parseInt(f.mode, 8)) return Promise.reject(fail("BAD_BUNDLE", path + ": mode " + (e.mode || 0).toString(8) + ", not " + f.mode));
        total += e.data.length;
        got[path] = e;
    }
    if (total > RULES.maxUnpackedBytes) return Promise.reject(fail("BAD_BUNDLE", "The bundle unpacks to more than " + RULES.maxUnpackedBytes + " bytes"));
    var missing = manifest.files.filter(function (f) { return !got[f.path]; })[0];
    if (missing) return Promise.reject(fail("BAD_BUNDLE", "The bundle lacks " + missing.path));
    return manifest.files.reduce(function (chain, f) {
        return chain.then(function (out) {
            return Promise.resolve(opts.sha256(got[f.path].data)).then(function (h) {
                if (typeof h !== "string") h = toHex(h);
                if (h !== f.sha256) throw fail("BAD_BUNDLE", f.path + ": its SHA-256 differs from devpush.json's");
                out.push({ path: f.path, mode: parseInt(f.mode, 8), data: got[f.path].data });
                return out;
            });
        });
    }, Promise.resolve([]));
}

module.exports = {
    FORMAT: FORMAT, PARTS: PARTS, RULES: RULES,
    wellFormed: wellFormed, pathProblem: pathProblem, overlayable: overlayable, partOf: partOf, mountOf: mountOf,
    restartsFor: restartsFor, partsFor: partsFor, checkManifest: checkManifest, verify: verify
};
