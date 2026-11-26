// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.nova: the device's end of dev push (docs/DEV-PUSH.md),
// novad, after Palm's novacomd. It lays dev bundles (changed system files,
// signed) into the developer overlay, restarts only what they change, puts
// files back as the image has them, pairs computers with a six-digit code,
// and keeps who it trusts for bundles. service.js runs it on a device (the
// Luna methods below, and the TLS server of lib/server.js on port 6965);
// sim.js runs it for the simulator over a folder (lib/overlay.js
// createDirectOverlay). Written against injected dependencies, so the
// tests run it over a temporary folder as the root with stand-ins for
// mount, mknod, systemctl, ls-control and pkill that record their calls.
//
// Files (under the root):
//   /var/luna/dev-mode-enabled           Developer Mode is on (the flag
//                                        file of LuneOS's devmode service,
//                                        which Phoenix's provider keeps: P3)
//   /var/lib/phoenix/overlay/state.json  the overlay: its build, the files
//                                        it holds and removes (from which
//                                        bundle, by whom, when), the
//                                        bundles applied, "clear" (Revert
//                                        to Image at the next boot)
//   /var/lib/phoenix/overlay/<BUILD_ID>/{upper,work,bundles,journal.json}
//   /var/lib/phoenix/nova/               root only: device-key (Ed25519,
//                                        made on first start), paired.json,
//                                        grants.json, revocations.json,
//                                        counters.json and rate.json (no
//                                        replay and 10 a day: kept across
//                                        Revert to Image), options.json,
//                                        waiting/ (bundles for the owner to
//                                        Apply), log.json
//   /etc/os-release BUILD_ID, /usr/share/phoenix/manifest.json (the
//   image's files, its product line and compatible),
//   /etc/palm/phoenix/servers.json "devpush" {key} (the platform's
//   dev-signing key, pinned by the image)
//
// Luna methods (Settings > Developer Mode; every one but getStatus answers
// NEEDS_DEVMODE while Developer Mode is off, 9.2):
//   getStatus {subscribe?}  -> status (below), again after every change
//   listWaiting {}          -> {bundles: [waiting bundle]}: bundles from the
//                              platform's key or a granted key, for the
//                              owner to Apply
//   apply {id, passCode}    the device passcode, checked here
//                           (com.palm.systemmanager matchDevicePasscode);
//                           -> {applied, restarted, pendingReboot}
//   decline {id}
//   revert {path?}          one file back to the image's; without a path
//                           Revert to Image: cleared at the next boot, and
//                           the device restarts
//   restartNow {}           the restart a change still needs
//   pairStart {}            -> {code, fingerprint, expires}: Pair a Computer
//   pairCancel {}
//   listKeys {}             -> {paired, grants, master}
//   removeKey {key}         a paired computer's key, or a grant's id
//   addGrant {grant, signature}         a signed grant certificate (9.1)
//   setRevocations {list, signature}    a signed revocation list
//   setOptions {network?, usb?, overlayCap?}
//   restart {what}          "shell" | "wam" | "app:<id>" | "service:<id>"
//   rescan {}               the application manager's (Palm's rescan)
//
// Errors (errorCode): devpush.js verify()'s (NEEDS_DEVMODE, UNTRUSTED,
// TOO_BIG, NOT_A_BUNDLE, BAD_BUNDLE, WRONG_BUILD, WRONG_PRODUCT,
// WRONG_DEVICE, REPLAY, REFUSED_PATH, OUT_OF_SCOPE, NO_SPACE), RATE_LIMITED,
// WRITE_FAILED (rolled back), NOT_FOUND, BAD_PASSCODE, NOT_PAIRING,
// PAIRING_CLOSED, BAD_GRANT, BAD_REVOCATIONS, BAD_PARAMS, BUSY.

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var devpush = require("@phoenix/platform/src/devpush");
var ipkLib = require("@phoenix/platform/src/ipk");
var keys = require("./lib/keys");
var overlayLib = require("./lib/overlay");
var trust = require("./lib/trust");
var pake = require("./lib/pake");

var SERVICE = "org.webosphoenix.nova";
var METHODS = ["getStatus", "listWaiting", "apply", "decline", "revert", "restartNow", "pairStart", "pairCancel", "listKeys", "removeKey",
               "addGrant", "setRevocations", "setOptions", "restart", "rescan"];
var DEVMODE_FLAG = "/var/luna/dev-mode-enabled";
var NOVA = "/var/lib/phoenix/nova";
var OVERLAY = overlayLib.OVERLAY;
var MANIFEST = "/usr/share/phoenix/manifest.json";
var PAIR_SECONDS = 120;
var PAIR_RUNS = 5;
var RATE_PER_DAY = 10;
var KEEP_BUNDLES = 5;
var DEFAULTS = { network: false, usb: true, overlayCap: devpush.RULES.maxOverlayBytes };

function fail(code, text, extra) {
    var e = new Error(text);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
}
function ok(o) { return Object.assign({ returnValue: true }, o || {}); }
function failed(e) {
    return { returnValue: false, errorCode: e.code || "UNKNOWN_ERROR", errorText: e.message || String(e) };
}

// deps:
//   root              "/" on a device
//   run(cmd, args)    -> Promise<{stdout}>: mount, mknod, systemctl,
//                     ls-control, pkill (a device: lib/system.js)
//   luna.call(uri, params) -> Promise<payload>
//   overlay?(build)   the backend (default the device's, lib/overlay.js)
//   whiteout?         the device backend's mknod stand-in (tests)
//   matchPasscode?(code) -> Promise<bool>  (default: com.palm.systemmanager)
//   notify?(text)     a notification ("Developer changes from ...")
//   config?           {shellUnit, wamUnit, authorizedKeys (the `user`
//                     account's ~/.ssh/authorized_keys, nova term)}
//   The simulator's (sim.js): build, manifest() (the image's manifest),
//   restart(what) -> Promise (in place of the device's restart map's
//   commands), readFile(path) -> Buffer
//   now?() -> Date; log?(text); random?(n) -> Buffer
function createNova(deps) {
    var root = deps.root || "/";
    var run = deps.run;
    var luna = deps.luna || { call: function () { return Promise.resolve({ returnValue: false }); } };
    var now = deps.now || function () { return new Date(); };
    var log = deps.log || function () {};
    var random = deps.random || crypto.randomBytes;
    var config = Object.assign({ shellUnit: "luna-surfacemanager.service", wamUnit: "webapp-mgr.service",
                                 authorizedKeys: "/home/user/.ssh/authorized_keys" }, deps.config || {});
    var P = function (p) { return path.join(root, p); };
    var watchers = [];
    var busy = null;
    var pairing = null;      // {code, expires, runs, timer}
    var ipk = ipkLib.createIpk({ gzip: {
        gzip: function (b) { return Promise.resolve(new Uint8Array(require("zlib").gzipSync(b))); },
        gunzip: function (b) {
            return Promise.resolve(new Uint8Array(require("zlib").gunzipSync(b, { maxOutputLength: devpush.RULES.maxUnpackedBytes + (1 << 20) })));
        }
    } });

    // ---- Files ------------------------------------------------------------------------
    function readJson(p, dflt) {
        try { return JSON.parse(fs.readFileSync(P(p), "utf8")); } catch (e) { return dflt; }
    }
    function writeJson(p, obj, mode) {
        var f = P(p);
        fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
        fs.writeFileSync(f + ".new", JSON.stringify(obj, null, 1) + "\n", { mode: mode || 0o600 });
        fs.renameSync(f + ".new", f);
    }
    function devMode() { try { fs.statSync(P(DEVMODE_FLAG)); return true; } catch (e) { return false; } }
    function osRelease() {
        var out = {};
        try {
            fs.readFileSync(P("/etc/os-release"), "utf8").split("\n").forEach(function (line) {
                var m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
                if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
            });
        } catch (e) { /* none */ }
        return out;
    }
    function imageManifest() { return deps.manifest ? deps.manifest() : readJson(MANIFEST, null); }
    // The running image: {build, product (line), compatible, id}.
    function image() {
        var m = imageManifest() || {};
        var product = m.product && m.product.line;
        if (!product) {
            var pj = readJson("/usr/share/phoenix/product.json", {});
            var mm = /^(\d+)\./.exec(String(pj.version || ""));
            product = mm ? mm[1] + ".0" : null;
        }
        return { build: deps.build || osRelease().BUILD_ID || m.build || null, product: product, compatible: m.compatible || null,
                 id: deviceKey().deviceId };
    }

    // ---- Keys -----------------------------------------------------------------------------
    var devKey = null;
    function deviceKey() {
        if (devKey) return devKey;
        var f = P(NOVA + "/device-key");
        var pem;
        try { pem = fs.readFileSync(f, "utf8"); } catch (e) {
            fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
            pem = keys.generate("novad").pem;
            fs.writeFileSync(f, pem, { mode: 0o600, flag: "wx" });
        }
        devKey = keys.fromPem(pem, "novad");
        // The id a bundle names (devpush.json "device"): this device's key,
        // which only Full Erase changes.
        devKey.deviceId = "nova-" + crypto.createHash("sha256").update(Buffer.from(devKey.publicKey, "base64")).digest("hex").slice(0, 16);
        return devKey;
    }
    function master() {
        var s = readJson("/etc/palm/phoenix/servers.json", {});
        var k = s && s.devpush && s.devpush.key;
        return typeof k === "string" && /^(ed25519:)?[A-Za-z0-9+/]{43}=$/.test(k) ? k.replace(/^ed25519:/, "") : null;
    }
    function paired() { return readJson(NOVA + "/paired.json", []); }
    function grants() { return readJson(NOVA + "/grants.json", []); }
    function revocations() { return readJson(NOVA + "/revocations.json", null); }
    // A key the signed revocation list names is trusted for nothing (9.1):
    // no bundles, no paired connection, no SSH login, no pairing again.
    function isRevoked(key) {
        var rv = revocations();
        var k = String(key || "").replace(/^ed25519:/, "");
        return !!(rv && rv.list && (rv.list.keys || []).some(function (x) { return String(x).replace(/^ed25519:/, "") === k; }));
    }
    function trustList() {
        return trust.trustList({ master: master(), paired: paired(), grants: grants(), revocations: revocations() && revocations().list });
    }
    function options() { return Object.assign({}, DEFAULTS, readJson(NOVA + "/options.json", {})); }

    // ---- The overlay's state ------------------------------------------------------------------
    function state() {
        var s = readJson(OVERLAY + "/state.json", null);
        var b = image().build;
        if (!s) s = { format: 1, build: b, clear: false, files: {}, removed: {}, bundles: [], pendingReboot: false, restarts: [] };
        return s;
    }
    function saveState(s) { writeJson(OVERLAY + "/state.json", s, 0o644); }
    // The state for the running build: an overlay made for another build is
    // left alone (com.palm.update deletes it once the new slot is good; a
    // fall back to the old slot finds it), and this build starts empty.
    function currentState() {
        var s = state(), b = image().build;
        if (s.build !== b) s = { format: 1, build: b, clear: false, files: {}, removed: {}, bundles: [], pendingReboot: false, restarts: [] };
        return s;
    }
    function backend(build) {
        return deps.overlay ? deps.overlay(build) : overlayLib.createDeviceOverlay({ root: root, build: build, run: run, whiteout: deps.whiteout });
    }
    function usage(s) {
        return Object.keys(s.files).reduce(function (n, p) { return n + (s.files[p].size || 0); }, 0);
    }

    function status() {
        var s = currentState(), img = image(), opts = options(), k = deviceKey();
        var b = backend(s.build);
        var files = Object.keys(s.files).sort().map(function (p) { return Object.assign({ path: p }, s.files[p]); });
        var removed = Object.keys(s.removed).sort().map(function (p) { return Object.assign({ path: p }, s.removed[p]); });
        return {
            devMode: devMode(),
            build: img.build, product: img.product, compatible: img.compatible, deviceId: img.id,
            fingerprint: k.fingerprint,
            active: !s.clear && (files.length + removed.length) > 0 && b.mounted().length > 0,
            mounted: b.mounted(),
            clearing: !!s.clear,
            files: files, removed: removed,
            bundles: s.bundles.slice(-10).reverse(),
            usage: usage(s), cap: opts.overlayCap,
            pendingReboot: !!s.pendingReboot, restarts: s.restarts || [],
            waiting: listWaitingSync().length,
            pairing: pairing ? { code: pairing.code, fingerprint: k.fingerprint, expires: new Date(pairing.expires).toISOString(),
                                 runsLeft: PAIR_RUNS - pairing.runs } : null,
            paired: paired().length,
            options: { network: opts.network, usb: opts.usb, overlayCap: opts.overlayCap }
        };
    }
    function changed() {
        var st;
        try { st = status(); } catch (e) { log("status: " + e.message); return; }
        watchers.slice().forEach(function (w) { try { w(st); } catch (e) { /* a watcher's own */ } });
    }

    // ---- Checking and applying a bundle (5.3, 4.4) ----------------------------------------------

    function counters() { return readJson(NOVA + "/counters.json", {}); }
    function verifyBundle(bytes, signature) {
        var s = currentState(), opts = options();
        return devpush.verify(new Uint8Array(bytes), String(signature), {
            trust: trustList(), device: image(), devMode: devMode(), now: now(),
            lastCounter: function (scope) { return counters()[scope] || 0; },
            readIpk: ipk.read,
            sha256: function (b) { return crypto.createHash("sha256").update(b).digest("hex"); },
            sha512: function (b) { return Promise.resolve(new Uint8Array(crypto.createHash("sha512").update(b).digest())); },
            // What the overlay holds after this bundle: only its files when
            // it replaces, else those it does not overwrite as well.
            spaceLeft: function (m) {
                if (m.mode === "replace") return opts.overlayCap;
                var mine = {};
                m.files.forEach(function (f) { mine[f.path] = true; });
                var kept = Object.keys(s.files).filter(function (p) { return !mine[p]; })
                    .reduce(function (n, p) { return n + (s.files[p].size || 0); }, 0);
                return opts.overlayCap - kept;
            }
        });
    }

    // 10 a day per grant (9.1): the times of the last day's.
    function rateCheck(entry) {
        if (entry.kind !== "grant") return;
        var r = readJson(NOVA + "/rate.json", {});
        var day = now().getTime() - 86400000;
        var recent = (r[entry.grant.id] || []).filter(function (t) { return t > day; });
        if (recent.length >= RATE_PER_DAY) throw fail("RATE_LIMITED", "The grant " + entry.grant.id + " has had " + RATE_PER_DAY + " bundles in the last day");
    }
    function recordUse(entry, counter) {
        var scope = entry.kind === "grant" ? "grant:" + entry.grant.id : "key:" + entry.key;
        var c = counters();
        c[scope] = Math.max(c[scope] || 0, counter);
        // And the key's own: verify() checks a bundle against the key and
        // all its grants, so one a grant took never comes again under
        // another (a renewal), even once that grant is gone.
        if (entry.kind === "grant") c["key:" + entry.key] = Math.max(c["key:" + entry.key] || 0, counter);
        writeJson(NOVA + "/counters.json", c);
        if (entry.kind === "grant") {
            var r = readJson(NOVA + "/rate.json", {});
            var day = now().getTime() - 86400000;
            r[entry.grant.id] = (r[entry.grant.id] || []).filter(function (t) { return t > day; }).concat([now().getTime()]);
            writeJson(NOVA + "/rate.json", r);
        }
        if (entry.kind === "paired") {
            var list = paired();
            list.forEach(function (p) { if (p.key.replace(/^ed25519:/, "") === entry.key) p.lastUsed = now().toISOString(); });
            writeJson(NOVA + "/paired.json", list);
        }
    }
    function addLog(entry) {
        var l = readJson(NOVA + "/log.json", []);
        l.push(Object.assign({ at: now().toISOString() }, entry));
        writeJson(NOVA + "/log.json", l.slice(-200));
    }

    // One at a time: an apply, a revert or a restart.
    function exclusive(fn) {
        if (busy) return Promise.reject(fail("BUSY", "Another change is being made"));
        busy = Promise.resolve().then(fn);
        return busy.then(function (r) { busy = null; return r; }, function (e) { busy = null; throw e; });
    }

    // The parts a bundle may change, from the trust entry that authorizes
    // it: a grant's parts (9.1); null (every part) for the platform's key
    // and a paired computer.
    function scopeOf(entry) {
        return entry && entry.kind === "grant" ? ((entry.grant && entry.grant.parts) || []).slice() : null;
    }
    // A replace's implicit reverts (4.4): the paths the overlay changes now
    // (state s) that the bundle leaves out, within scope only: a grant's
    // replace puts back what that grant could change itself, and leaves the
    // rest (the owner's paired computers' shell, service or role changes,
    // say) as it is. An add reverts nothing.
    function revertsFor(mode, paths, scope, s) {
        if (mode !== "replace") return [];
        var inBundle = {};
        paths.forEach(function (p) { inBundle[p] = true; });
        return Object.keys(s.files).concat(Object.keys(s.removed)).filter(function (p) {
            return !inBundle[p] && (!scope || scope.indexOf(devpush.partOf(p)) >= 0);
        }).sort();
    }
    // Everything a verified bundle changes on this overlay: its files and
    // removals and the implicit reverts, every path's part checked against
    // the scope of the entry that authorizes it (verify() checks the
    // manifest's parts; this checks the whole effective set), and the
    // restarts they all need. -> {reverts, paths, restart}
    function changeSet(v, s) {
        var m = v.manifest, scope = scopeOf(v.trust);
        var own = m.files.map(function (f) { return f.path; }).concat(m.removed);
        var reverts = revertsFor(m.mode, own, scope, s);
        var paths = own.concat(reverts);
        var outside = scope ? devpush.partsFor(paths).filter(function (p) { return scope.indexOf(p) < 0; }) : [];
        if (outside.length) {
            throw fail("OUT_OF_SCOPE", "The grant " + v.trust.grant.id + " does not allow changes to " + outside.join(", "));
        }
        // The overlay afterwards under its cap: the bundle's files and what
        // it keeps, which a grant's replace leaves outside its parts and
        // verify()'s spaceLeft does not see.
        var gone = {};
        paths.forEach(function (p) { gone[p] = true; });
        var kept = Object.keys(s.files).filter(function (p) { return !gone[p]; })
            .reduce(function (n, p) { return n + (s.files[p].size || 0); }, 0);
        var size = v.files.reduce(function (n, f) { return n + f.data.length; }, 0);
        var cap = options().overlayCap;
        if (kept + size > cap) {
            throw fail("NO_SPACE", "The bundle's files need " + size + " bytes; the overlay has " + Math.max(0, cap - kept) + " left");
        }
        return { reverts: reverts, paths: paths, restart: devpush.restartsFor(paths) };
    }

    // A checked bundle into the overlay (4.4): replace (the overlay ends up
    // holding exactly the bundle's files: the others go back to the image's,
    // within a grant's parts: changeSet) or add; every write through the
    // backend; a failure part way puts every path back as it was and says
    // which file failed. Then the restarts.
    function applyVerified(v, bytes, signature, onProgress) {
        var m = v.manifest;
        var progress = onProgress || function () {};
        var s = currentState();
        var b = backend(s.build);
        var cs = changeSet(v, s);
        var reverts = cs.reverts;
        var ops = v.files.map(function (f) { return { op: "write", path: f.path, data: f.data, mode: f.mode }; })
            .concat(m.removed.map(function (p) { return { op: "remove", path: p }; }))
            .concat(reverts.map(function (p) { return { op: "revert", path: p }; }));
        var done = [];
        var at = now().toISOString();
        return ops.reduce(function (chain, o) {
            return chain.then(function () {
                var snap = b.snapshot(o.path);
                done.push({ path: o.path, snap: snap });
                var step = o.op === "write" ? b.write(o.path, Buffer.from(o.data), o.mode) : o.op === "remove" ? b.remove(o.path) : b.revert(o.path);
                return Promise.resolve(step).then(function () {
                    progress({ step: o.op, path: o.path });
                }, function (e) { throw fail("WRITE_FAILED", "Could not write " + o.path + ": " + e.message + ". Nothing was changed", { path: o.path }); });
            }).then(null, function (e) {
                if (e.code !== "WRITE_FAILED") e = fail("WRITE_FAILED", "Could not write " + o.path + ": " + e.message + ". Nothing was changed", { path: o.path });
                throw e;
            });
        }, Promise.resolve()).then(null, function (e) {
            // Put back what was written, last first.
            return done.reverse().reduce(function (chain, d) {
                return chain.then(function () { return b.restore(d.path, d.snap); }).then(null, function (x) { log("rollback " + d.path + ": " + x.message); });
            }, Promise.resolve()).then(function () {
                addLog({ event: "failed", bundle: m.id, by: m.by, error: e.message });
                throw e;
            });
        }).then(function () {
            // Mounted now where the files went into upper/ directly (4.3).
            var touched = overlayLib.MOUNTS.filter(function (mt) {
                return ops.some(function (o) { return o.path.indexOf(mt + "/") === 0; });
            });
            return b.mount(touched);
        }).then(function () {
            reverts.forEach(function (p) { delete s.files[p]; delete s.removed[p]; });
            var who = { bundle: m.id, by: m.by, name: v.trust.name || null, kind: v.trust.kind, at: at };
            m.files.forEach(function (f) {
                delete s.removed[f.path];
                s.files[f.path] = Object.assign({ sha256: f.sha256, size: f.size, mode: f.mode }, who);
            });
            m.removed.forEach(function (p) { delete s.files[p]; s.removed[p] = who; });
            s.clear = false;
            s.bundles.push({ id: m.id, by: m.by, fingerprint: keys.fingerprint(m.by), name: v.trust.name || null, kind: v.trust.kind,
                             note: m.note || null, made: m.made, applied: at, mode: m.mode, files: m.files.length,
                             removed: m.removed.length, reverted: reverts.length, parts: m.parts });
            s.bundles = s.bundles.slice(-50);
            saveState(s);
            keepBundle(s.build, m.id, bytes, signature);
            recordUse(v.trust, m.counter);
            journal(s.build, { event: "apply", bundle: m.id, files: m.files.map(function (f) { return f.path; }), removed: m.removed, reverted: reverts });
            addLog({ event: "applied", bundle: m.id, by: m.by, name: v.trust.name || null, kind: v.trust.kind, files: m.files.length });
            // The device works the restarts out from the paths itself; the
            // bundle's own list is only what its maker expected.
            return runRestarts(cs.restart, progress);
        }).then(function (restarted) {
            changed();
            return { applied: m.id, files: m.files.length, removed: m.removed.length, reverted: reverts.length, restarted: restarted,
                     pendingReboot: currentState().pendingReboot };
        });
    }
    function keepBundle(build, id, bytes, signature) {
        var dir = P(OVERLAY + "/" + build + "/bundles");
        try {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            fs.writeFileSync(path.join(dir, id + ".ipk"), Buffer.from(bytes), { mode: 0o600 });
            fs.writeFileSync(path.join(dir, id + ".ipk.sig"), String(signature), { mode: 0o600 });
            var all = fs.readdirSync(dir).filter(function (n) { return /\.ipk$/.test(n); })
                .map(function (n) { return { n: n, t: fs.statSync(path.join(dir, n)).mtimeMs }; })
                .sort(function (a, c) { return a.t - c.t; });
            all.slice(0, Math.max(0, all.length - KEEP_BUNDLES)).forEach(function (x) {
                fs.rmSync(path.join(dir, x.n), { force: true });
                fs.rmSync(path.join(dir, x.n + ".sig"), { force: true });
            });
        } catch (e) { log("keeping the bundle: " + e.message); }
    }
    function journal(build, entry) {
        var f = OVERLAY + "/" + build + "/journal.json";
        var j = readJson(f, []);
        j.push(Object.assign({ at: now().toISOString() }, entry));
        writeJson(f, j.slice(-200));
    }

    // ---- The restart map (4.5) -------------------------------------------------------------------

    function lunaOk(uri, params) {
        return Promise.resolve(luna.call(uri, params || {})).then(function (r) {
            if (r && r.returnValue === false) throw new Error(r.errorText || uri + " failed");
            return r || {};
        });
    }
    function restartOne(r) {
        if (deps.restart) return deps.restart(r);       // the simulator's own
        var kind = r.split(":")[0], id = r.slice(kind.length + 1);
        switch (kind) {
        case "hub": return run("ls-control", ["scan-services"]);
        case "configurator":
            return lunaOk("luna://com.palm.configurator/run", { types: ["dbkinds", "dbpermissions", "activities"] });
        case "rescan": return lunaOk("luna://com.palm.applicationManager/rescan", {});
        case "service": return run("pkill", ["-f", "/usr/palm/services/" + id + "/"]).then(null, function (e) {
            // pkill: 1 when no process matched (not running: nothing to stop).
            if (e.exitCode !== 1) throw e;
        });
        case "app":
            return lunaOk("luna://com.webos.applicationManager/running", {}).then(function (rr) {
                var open = (rr.running || []).some(function (a) { return a.id === id; });
                if (!open) return { open: false };
                return lunaOk("luna://com.webos.applicationManager/closeByAppId", { id: id })
                    .then(function () { return lunaOk("luna://com.webos.applicationManager/launch", { id: id }); })
                    .then(function () { return { open: true }; });
            });
        case "wam": return run("systemctl", ["restart", config.wamUnit]);
        case "shell": return run("systemctl", ["restart", config.shellUnit]);
        default: return Promise.resolve();
        }
    }
    // Narrowest first, each once; "reboot" restarts nothing live ("Restart
    // the device to finish"). -> [{what, ok, error?}]
    function runRestarts(list, progress) {
        var s = currentState();
        var out = [];
        var reboot = false;
        return list.reduce(function (chain, r) {
            return chain.then(function () {
                if (r === "reboot") { reboot = true; out.push({ what: r, ok: true, pending: true }); return; }
                return Promise.resolve(restartOne(r)).then(function () { out.push({ what: r, ok: true }); },
                    function (e) {
                        // Without a rescan (an image whose application manager
                        // has none) the apps are read again at the next start.
                        if (r === "rescan") reboot = true;
                        out.push({ what: r, ok: false, error: e.message, pending: r === "rescan" || undefined });
                        log("restart " + r + ": " + e.message);
                    })
                    .then(function () { if (progress) progress({ step: "restart", what: r }); });
            });
        }, Promise.resolve()).then(function () {
            s = currentState();
            if (reboot) s.pendingReboot = true;
            s.restarts = out;
            saveState(s);
            return out;
        });
    }

    // ---- Bundles that wait for the owner (7.4) --------------------------------------------------

    var WAITING = NOVA + "/waiting";
    function listWaitingSync() {
        var dir = P(WAITING);
        var names;
        try { names = fs.readdirSync(dir); } catch (e) { return []; }
        var s = currentState();
        return names.filter(function (n) { return /\.json$/.test(n); }).map(function (n) {
            var meta;
            try { meta = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")); } catch (e) { return null; }
            // What its Apply would put back now (the overlay may have changed
            // since it came), and the restarts with those reverts.
            var own = (meta.files || []).concat(meta.removed || []);
            meta.reverts = revertsFor(meta.mode, own, meta.scope === undefined ? null : meta.scope, s);
            meta.restart = devpush.restartsFor(own.concat(meta.reverts));
            return meta;
        }).filter(Boolean).sort(function (a, c) { return a.received < c.received ? -1 : 1; });
    }
    // A checked bundle the owner must Apply: from the platform's key, a
    // granted key, or a paired computer's key that is not the one sending it.
    function enqueue(v, bytes, signature, from) {
        var m = v.manifest;
        var cs = changeSet(v, currentState());
        var dir = P(WAITING);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(dir, m.id + ".ipk"), Buffer.from(bytes), { mode: 0o600 });
        fs.writeFileSync(path.join(dir, m.id + ".ipk.sig"), String(signature), { mode: 0o600 });
        var size = v.files.reduce(function (n, f) { return n + f.data.length; }, 0);
        var meta = {
            id: m.id, by: m.by, fingerprint: keys.fingerprint(m.by), kind: v.trust.kind, name: v.trust.name || null,
            grant: v.trust.grant ? v.trust.grant.id : null, note: m.note || null, made: m.made, received: now().toISOString(),
            from: from || null, mode: m.mode, parts: m.parts, roles: m.parts.indexOf("roles") >= 0,
            files: m.files.map(function (f) { return f.path; }), removed: m.removed,
            // A replace's implicit reverts and the parts they may come from
            // (listWaitingSync works them out again against the overlay as
            // it is then); restart: for the files, removals and reverts.
            scope: scopeOf(v.trust), reverts: cs.reverts, restart: cs.restart, size: size, bytes: bytes.length
        };
        fs.writeFileSync(path.join(dir, m.id + ".json"), JSON.stringify(meta, null, 1) + "\n", { mode: 0o600 });
        addLog({ event: "waiting", bundle: m.id, by: m.by, name: meta.name, kind: meta.kind });
        if (deps.notify) {
            try { deps.notify("Developer changes from " + (meta.name || meta.fingerprint) + (meta.note ? ": " + meta.note : ""), meta); }
            catch (e) { log("notify: " + e.message); }
        }
        changed();
        return meta;
    }
    function readWaiting(id) {
        if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) throw fail("BAD_PARAMS", "id: a bundle id");
        var dir = P(WAITING);
        try {
            return { bytes: fs.readFileSync(path.join(dir, id + ".ipk")), signature: fs.readFileSync(path.join(dir, id + ".ipk.sig"), "utf8") };
        } catch (e) { throw fail("NOT_FOUND", "No bundle " + id + " is waiting"); }
    }
    function dropWaiting(id) {
        ["ipk", "ipk.sig", "json"].forEach(function (x) { fs.rmSync(P(WAITING + "/" + id + "." + x), { force: true }); });
    }

    // ---- What the TLS server and the Luna methods share ---------------------------------------

    // A bundle sent by a connected computer (key: base64 of its key): one
    // signed by that same paired key is applied at once (the developer is
    // at their own computer, and paired with the owner at the device);
    // anything else that verifies waits for the owner's Apply.
    function receive(bytes, signature, from, onProgress) {
        if (!devMode()) return Promise.reject(fail("NEEDS_DEVMODE", "Developer Mode is off"));
        return exclusive(function () {
            return verifyBundle(bytes, signature).then(function (v) {
                rateCheck(v.trust);
                if (v.trust.kind === "paired" && from && from.key === v.trust.key) {
                    return applyVerified(v, bytes, signature, onProgress).then(function (r) { return Object.assign({ waiting: false }, r); });
                }
                var meta = enqueue(v, bytes, signature, from && from.name);
                return { waiting: true, id: meta.id };
            });
        });
    }

    // One file back to the image's (4.6), live; or every file: Revert to
    // Image, at the next boot.
    function revertPath(p) {
        return exclusive(function () {
            var s = currentState();
            if (!s.files[p] && !s.removed[p]) throw fail("NOT_FOUND", p + " is not changed by the overlay");
            var b = backend(s.build);
            var snap = b.snapshot(p);
            return Promise.resolve(b.revert(p)).then(null, function (e) {
                return Promise.resolve(b.restore(p, snap)).then(function () { throw fail("WRITE_FAILED", "Could not put back " + p + ": " + e.message); });
            }).then(function () {
                delete s.files[p];
                delete s.removed[p];
                saveState(s);
                journal(s.build, { event: "revert", path: p });
                addLog({ event: "reverted", path: p });
                return runRestarts(devpush.restartsFor([p]));
            }).then(function (restarted) {
                changed();
                return { reverted: p, restarted: restarted };
            });
        });
    }
    function revertAll() {
        return exclusive(function () {
            var s = state();
            s.clear = true;
            saveState(s);
            addLog({ event: "revert to image" });
            changed();
            return run("systemctl", ["reboot"]).then(function () { return { restarting: true }; });
        });
    }

    // ---- Pairing (6.4) ------------------------------------------------------------------------

    function pairStart() {
        if (pairing && pairing.timer) clearTimeout(pairing.timer);
        // Six digits, uniform (rejection sampling over 20 bits).
        var n;
        do { n = random(3).readUIntBE(0, 3) & 0xfffff; } while (n >= 1000000);
        var code = String(n).padStart(6, "0");
        pairing = { code: code, expires: now().getTime() + PAIR_SECONDS * 1000, runs: 0 };
        pairing.timer = setTimeout(function () { pairing = null; changed(); }, PAIR_SECONDS * 1000);
        if (pairing.timer.unref) pairing.timer.unref();
        changed();
        return { code: code, fingerprint: deviceKey().fingerprint, expires: new Date(pairing.expires).toISOString(), seconds: PAIR_SECONDS };
    }
    function pairCancel() {
        if (pairing && pairing.timer) clearTimeout(pairing.timer);
        pairing = null;
        changed();
    }
    // One run of the exchange with a computer whose TLS key is clientKey
    // (base64), over a connection whose exporter is aad. Five runs a window;
    // a run counts from its first message, so one that never finishes is
    // one of them. -> {reply: {pB, confirm}, finish(cA, proof, name) ->
    // {proof}}
    function pairRun(clientKey, aad, pA) {
        if (!devMode()) throw fail("NEEDS_DEVMODE", "Developer Mode is off");
        if (isRevoked(clientKey)) throw fail("UNTRUSTED", "This computer's key is revoked");
        if (!pairing || now().getTime() > pairing.expires) throw fail("NOT_PAIRING", "The device is not showing a pairing code: open Settings > Developer Mode > Pair a Computer");
        if (pairing.runs >= PAIR_RUNS) { pairCancel(); throw fail("PAIRING_CLOSED", "Too many wrong codes: start Pair a Computer again"); }
        pairing.runs++;
        var mine = pairing;
        changed();
        var ids = pairIdentities(clientKey, deviceKey().publicKey);
        var party = pake.party("B", { code: mine.code, salt: ids.salt, A: ids.A, B: ids.B, aad: aad });
        var res = party.finish(Buffer.from(pA, "base64"));
        return {
            reply: { pB: party.start().toString("base64"), confirm: res.confirm.toString("base64") },
            finish: function (cA, proof, name) {
                // Only within the window the run began in: one the owner
                // cancelled, that ran out, that a new Pair a Computer
                // replaced, or that another computer's pairing closed takes
                // no confirmation, however good.
                if (pairing !== mine || now().getTime() > mine.expires) {
                    throw fail("NOT_PAIRING", "The pairing code this run used is no longer shown: start Pair a Computer again");
                }
                if (!party.verify(Buffer.from(String(cA), "base64"))) {
                    if (mine.runs >= PAIR_RUNS && pairing === mine) pairCancel();
                    throw fail("PAIRING_FAILED", "Wrong code");
                }
                if (!trust.verifySig(proofText("A", res.TT), proof, clientKey)) throw fail("PAIRING_FAILED", "The computer's key did not sign the exchange");
                addPaired(clientKey, name);
                if (pairing === mine) pairCancel();
                return { proof: crypto.sign(null, Buffer.from(proofText("B", res.TT)), deviceKey().privateKey).toString("base64") };
            }
        };
    }
    function addPaired(key, name) {
        if (isRevoked(key)) throw fail("UNTRUSTED", "This computer's key is revoked");
        var list = paired().filter(function (p) { return p.key !== key; });
        list.push({ key: key, fingerprint: keys.fingerprint(key), name: String(name || "Computer").slice(0, 64), paired: now().toISOString(), lastUsed: null });
        writeJson(NOVA + "/paired.json", list);
        authorizedKeys();
        addLog({ event: "paired", key: key, name: name || null });
        changed();
    }
    // The paired computers' keys may log in as `user` over Developer Mode's
    // SSH (nova term): the lines nova writes in that account's
    // authorized_keys, between markers; the rest of the file is left alone.
    function authorizedKeys() {
        var f = P(config.authorizedKeys);
        var text = "";
        try { text = fs.readFileSync(f, "utf8"); } catch (e) { if (!fs.existsSync(path.dirname(f))) return; }
        var begin = "# nova: paired computers (org.webosphoenix.nova)", end = "# nova: end";
        var re = new RegExp("\\n?" + begin.replace(/[()]/g, "\\$&") + "[\\s\\S]*?" + end + "\\n?");
        text = text.replace(re, "\n").replace(/^\n+/, "");
        var lines = paired().filter(function (p) { return !isRevoked(p.key); }).map(function (p) { return keys.sshPublic(p.key, "nova:" + p.name.replace(/\s+/g, "_")); });
        if (lines.length) text = (text ? text.replace(/\n?$/, "\n") : "") + begin + "\n" + lines.join("\n") + "\n" + end + "\n";
        fs.writeFileSync(f, text, { mode: 0o600 });
    }

    function isPaired(key) { return !isRevoked(key) && paired().some(function (p) { return p.key === key; }); }
    // After a new revocation list: a revoked key leaves the paired list and
    // authorized_keys (lib/proto.js closes its open connections).
    function dropRevoked() {
        var list = paired();
        var left = list.filter(function (p) { return !isRevoked(p.key); });
        if (left.length !== list.length) {
            writeJson(NOVA + "/paired.json", left);
            list.filter(function (p) { return isRevoked(p.key); }).forEach(function (p) { addLog({ event: "unpaired", key: p.key, reason: "revoked" }); });
        }
        authorizedKeys();
    }

    // ---- Luna methods ----------------------------------------------------------------------------

    function gate() { if (!devMode()) throw fail("NEEDS_DEVMODE", "Developer Mode is off"); }
    function wrap(fn) {
        return function (p) {
            return Promise.resolve().then(function () { return fn(p || {}); }).then(function (r) { return ok(r); }, failed);
        };
    }
    var methods = {
        getStatus: wrap(function () { return status(); }),
        listWaiting: wrap(function () { gate(); return { bundles: listWaitingSync() }; }),
        apply: wrap(function (p) {
            gate();
            var w = readWaiting(p.id);
            return Promise.resolve(deps.matchPasscode ? deps.matchPasscode(p.passCode)
                : lunaOk("luna://com.palm.systemmanager/matchDevicePasscode", { passCode: String(p.passCode || "") })
                    .then(function (r) { return r.succeeded === true; }, function () { return false; }))
                .then(function (good) {
                    if (!good) throw fail("BAD_PASSCODE", "That passcode is not correct");
                    return exclusive(function () {
                        return verifyBundle(w.bytes, w.signature).then(function (v) {
                            rateCheck(v.trust);
                            return applyVerified(v, w.bytes, w.signature);
                        });
                    });
                }).then(function (r) { dropWaiting(p.id); changed(); return r; }, function (e) {
                    // A bundle that no longer verifies (expired, revoked, another
                    // build) will never apply: it is dropped, and the reason said.
                    if (["UNTRUSTED", "WRONG_BUILD", "WRONG_PRODUCT", "WRONG_DEVICE", "REPLAY", "OUT_OF_SCOPE"].indexOf(e.code) >= 0) {
                        dropWaiting(p.id);
                        addLog({ event: "failed", bundle: p.id, error: e.message });
                        changed();
                    }
                    throw e;
                });
        }),
        decline: wrap(function (p) {
            gate();
            readWaiting(p.id);
            dropWaiting(p.id);
            addLog({ event: "declined", bundle: p.id });
            changed();
            return { declined: p.id };
        }),
        revert: wrap(function (p) {
            gate();
            if (p.path === undefined || p.path === null || p.path === "") return revertAll();
            if (typeof p.path !== "string" || devpush.pathProblem(p.path)) throw fail("BAD_PARAMS", "path: a device path the overlay may hold");
            return revertPath(p.path);
        }),
        restartNow: wrap(function () { gate(); return run("systemctl", ["reboot"]).then(function () { return { restarting: true }; }); }),
        pairStart: wrap(function () { gate(); return pairStart(); }),
        pairCancel: wrap(function () { pairCancel(); return {}; }),
        listKeys: wrap(function () {
            gate();
            var rv = revocations() && revocations().list;
            var m = master();
            return {
                paired: paired().map(function (p) { return { key: p.key, fingerprint: p.fingerprint, name: p.name, paired: p.paired, lastUsed: p.lastUsed }; }),
                grants: grants().map(function (e) {
                    var g = e.grant;
                    return { id: g.id, key: g.key, fingerprint: keys.fingerprint(g.key), name: g.name, account: g.account || null, devices: g.devices,
                             product: g.product, parts: g.parts, issued: g.issued, expires: g.expires,
                             expired: !(Date.parse(g.expires) > now().getTime()),
                             revoked: !!(rv && ((rv.grants || []).indexOf(g.id) >= 0 || (rv.keys || []).map(function (k) { return k.replace(/^ed25519:/, ""); })
                                 .indexOf(g.key.replace(/^ed25519:/, "")) >= 0)) };
                }),
                master: m ? { key: "ed25519:" + m, fingerprint: keys.fingerprint(m) } : null
            };
        }),
        removeKey: wrap(function (p) {
            gate();
            var k = String(p.key || "").replace(/^ed25519:/, "");
            var list = paired();
            var left = list.filter(function (x) { return x.key !== k; });
            if (left.length !== list.length) {
                writeJson(NOVA + "/paired.json", left);
                authorizedKeys();
                addLog({ event: "unpaired", key: k });
                changed();
                return { removed: "paired" };
            }
            var gl = grants();
            var gleft = gl.filter(function (e) { return e.grant.id !== p.key && e.grant.key.replace(/^ed25519:/, "") !== k; });
            if (gleft.length !== gl.length) {
                writeJson(NOVA + "/grants.json", gleft);
                addLog({ event: "grant removed", key: p.key });
                changed();
                return { removed: "grant" };
            }
            throw fail("NOT_FOUND", "No paired computer or grant " + p.key);
        }),
        addGrant: wrap(function (p) {
            gate();
            var text = typeof p.grant === "string" ? p.grant : JSON.stringify(p.grant);
            var g = trust.checkGrant(text, p.signature, master(), now());
            if (!(Date.parse(g.expires) > now().getTime())) throw fail("BAD_GRANT", "The grant expired on " + g.expires);
            if (g.devices.indexOf(image().id) < 0) throw fail("BAD_GRANT", "The grant does not cover this device (" + image().id + ")");
            // A renewal: the key's expired grants go (revoked ones stay, so
            // their bundles are refused with that reason).
            var list = grants().filter(function (e) {
                return e.grant.id !== g.id &&
                    !(e.grant.key === g.key && !(Date.parse(e.grant.expires) > now().getTime()) && Date.parse(e.grant.expires) < Date.parse(g.expires));
            });
            list.push({ grant: g, text: text, signature: String(p.signature).trim(), added: now().toISOString() });
            writeJson(NOVA + "/grants.json", list);
            addLog({ event: "grant added", grant: g.id, name: g.name });
            changed();
            return { grant: g.id };
        }),
        setRevocations: wrap(function (p) {
            gate();
            var text = typeof p.list === "string" ? p.list : JSON.stringify(p.list);
            var r = trust.checkRevocations(text, p.signature, master());
            var had = revocations();
            if (had && had.list.sequence > r.sequence) throw fail("BAD_REVOCATIONS", "The revocation list is older than the one this device has");
            writeJson(NOVA + "/revocations.json", { list: r, text: text, signature: String(p.signature).trim() });
            dropRevoked();
            changed();
            return { sequence: r.sequence };
        }),
        setOptions: wrap(function (p) {
            gate();
            var o = readJson(NOVA + "/options.json", {});
            if (p.network !== undefined) o.network = !!p.network;
            if (p.usb !== undefined) o.usb = !!p.usb;
            if (p.overlayCap !== undefined) {
                var c = Number(p.overlayCap);
                if (!Number.isSafeInteger(c) || c < (1 << 20) || c > 4 * devpush.RULES.maxOverlayBytes) throw fail("BAD_PARAMS", "overlayCap: bytes, 1 MB to 1 GB");
                o.overlayCap = c;
            }
            writeJson(NOVA + "/options.json", o);
            changed();
            return { options: options() };
        }),
        restart: wrap(function (p) {
            gate();
            if (!/^(shell|wam|app:[^/\s]+|service:[^/\s]+)$/.test(String(p.what || ""))) throw fail("BAD_PARAMS", "what: shell, wam, app:<id> or service:<id>");
            return runRestarts([p.what]).then(function (r) { return { restarted: r }; });
        }),
        rescan: wrap(function () { gate(); return runRestarts(["rescan"]).then(function (r) { return { restarted: r }; }); })
    };

    // At start: a key revoked while an older novad left it in paired.json, or
    // its SSH line in authorized_keys, is reconciled at once (dropRevoked), not
    // at the next pairing change or revocation list.
    if (revocations()) {
        try { dropRevoked(); } catch (e) { addLog({ event: "error", reason: "reconcile revocations: " + (e && e.message || e) }); }
    }

    return {
        methods: methods,
        // getStatus {subscribe}: fn(status) after every change -> stop()
        watch: function (fn) {
            watchers.push(fn);
            return function () { var i = watchers.indexOf(fn); if (i >= 0) watchers.splice(i, 1); };
        },
        status: status,
        image: image,
        imageManifest: imageManifest,
        devMode: devMode,
        options: options,
        deviceKey: deviceKey,
        isPaired: isPaired,
        isRevoked: isRevoked,
        paired: paired,
        receive: receive,
        verifyBundle: verifyBundle,
        revertPath: revertPath,
        revertAll: revertAll,
        restart: function (what) { return methods.restart({ what: what }); },
        rescan: function () { return methods.rescan({}); },
        pairStart: pairStart,
        pairCancel: pairCancel,
        pairRun: pairRun,
        unpair: function (key) { return methods.removeKey({ key: key }); },
        // A file as the device has it now (nova get): only under the
        // overlay's mounts.
        readFile: function (p) {
            if (typeof p !== "string" || !devpush.wellFormed(p) || !devpush.mountOf(p)) {
                throw fail("BAD_PARAMS", "Only files under " + devpush.RULES.mounts.join(", ") + " can be read");
            }
            if (deps.readFile) return deps.readFile(p);
            try { return fs.readFileSync(P(p)); } catch (e) { throw fail("NOT_FOUND", "No file " + p); }
        },
        changed: changed
    };
}

// What both sides sign at the end of pairing (6.4): each proves it holds
// its own key, over the run's transcript.
function proofText(role, TT) {
    return "nova-pair-proof-" + role + "\n" + crypto.createHash("sha256").update(TT).digest("hex");
}
// The run's identities: the computer's and the device's key fingerprints,
// and scrypt's salt from both.
function pairIdentities(clientKey, deviceKey) {
    var A = "nova:" + keys.fingerprint(clientKey), B = "novad:" + keys.fingerprint(deviceKey);
    return { A: A, B: B, salt: "nova-pair-v1\n" + A + "\n" + B };
}

module.exports = { SERVICE: SERVICE, METHODS: METHODS, DEVMODE_FLAG: DEVMODE_FLAG, NOVA: NOVA, MANIFEST: MANIFEST, PAIR_RUNS: PAIR_RUNS,
                   PAIR_SECONDS: PAIR_SECONDS, RATE_PER_DAY: RATE_PER_DAY, createNova: createNova, proofText: proofText,
                   pairIdentities: pairIdentities };
