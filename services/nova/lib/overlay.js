// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The developer overlay's two backends (docs/DEV-PUSH.md 4), for
// novaservice.js, and the decisions taken at boot.
//
// The device (createDeviceOverlay): one overlayfs per directory Phoenix
// ships into (devpush-paths.json "mounts"), its layers under
// /var/lib/phoenix/overlay/<BUILD_ID>/{upper,work}/<mount>. While a mount
// point's overlay is mounted, files are written through the merged path
// (<path>.nova-new, then a rename: overlayfs copies up, and readers see the
// old file or the new one) and removed by unlinking it there (a whiteout
// when the image has the file); the layers themselves are never touched
// while mounted, as overlayfs requires. Before the first push nothing is
// mounted: the files go into upper/ directly (whiteouts made with mknod,
// as overlayfs makes them), then the mount point is mounted (4.3). The
// image's copy of a file is read from the lower directory, bind-mounted at
// /run/phoenix/overlay/lower/<mount> before the overlay goes over it (4.6).
// Inside a mount, the refused paths (9.4) are bind-mounted back to the
// image's copy.
//
// The simulator (createDirectOverlay): a folder laid out like the device's
// root that phoenix-sim and tools/serve-rootfs.py read before the
// checkout's files (--developer-overlay); a removed file is a ".wh.<name>"
// file beside where it was (the AUFS convention), which they honour.
//
// Every path given to a backend is a device path the bundle rules allow
// (devpush.js pathProblem is null); root is "/" on a device and a temporary
// folder in the tests.

"use strict";

var fs = require("fs");
var path = require("path");
var devpush = require("@phoenix/platform/src/devpush");

var OVERLAY = "/var/lib/phoenix/overlay";
var LOWER = "/run/phoenix/overlay/lower";
var MOUNTS = devpush.RULES.mounts;

function exists(f) { try { fs.lstatSync(f); return true; } catch (e) { return false; } }
function readOrNull(f) {
    try {
        var st = fs.statSync(f);
        if (!st.isFile()) return null;
        return { data: fs.readFileSync(f), mode: st.mode & 0o777 };
    } catch (e) { return null; }
}
function writeAtomic(f, data, mode) {
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o755 });
    var tmp = f + ".nova-new";
    fs.writeFileSync(tmp, data, { mode: mode });
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, f);
}
function unlinkIfThere(f) { try { fs.unlinkSync(f); return true; } catch (e) { if (e.code !== "ENOENT") throw e; return false; } }

// The mount points with an overlay mounted on them: from <root>/proc/mounts
// ("overlay <mountpoint> overlay ...").
function mountedOverlays(root) {
    var out = {};
    var text;
    try { text = fs.readFileSync(path.join(root, "proc/mounts"), "utf8"); } catch (e) { return out; }
    text.split("\n").forEach(function (line) {
        var f = line.split(" ");
        if (f[2] === "overlay") out[f[1].replace(/\\040/g, " ")] = true;
    });
    return out;
}

// The refused paths inside a mount point, to bind back to the image's copy
// once its overlay is mounted: the directories and files of
// devpush-paths.json "refused" (the regular-expression ones are Luna files,
// matched below).
function refusedInside(mount) {
    return devpush.RULES.refused.filter(function (r) { return r.indexOf(mount + "/") === 0; })
        .map(function (r) { return r.replace(/\/$/, ""); });
}
// The image's files under mount that a refusedPatterns rule matches (the
// two services' Luna files), one folder deep as luna-service2 keeps them.
function refusedFilesIn(root, mount) {
    var res = devpush.RULES.refusedPatterns.map(function (p) { return new RegExp(p); });
    var out = [];
    var dirs;
    try { dirs = fs.readdirSync(path.join(root, mount)); } catch (e) { return out; }
    dirs.forEach(function (d) {
        var names;
        try { names = fs.readdirSync(path.join(root, mount, d)); } catch (e) { return; }
        names.forEach(function (n) {
            var p = mount + "/" + d + "/" + n;
            if (res.some(function (re) { return re.test(p); })) out.push(p);
        });
    });
    return out.sort();
}

// opts: {root, build, run(cmd, args) -> Promise, whiteout?: {make(file)
// -> Promise, is(file) -> bool}}
function createDeviceOverlay(opts) {
    var root = opts.root;
    var run = opts.run;
    var P = function (p) { return path.join(root, p); };
    var base = P(OVERLAY + "/" + opts.build);
    var whiteout = opts.whiteout || {
        // overlayfs's whiteout: a character device 0/0.
        make: function (f) { return run("mknod", [f, "c", "0", "0"]); },
        is: function (f) { try { var st = fs.lstatSync(f); return st.isCharacterDevice() && st.rdev === 0; } catch (e) { return false; } }
    };
    function upper(p) { return path.join(base, "upper", p); }
    function mountOf(p) { return devpush.mountOf(p); }
    function isMounted(m) { return !!mountedOverlays(root)[m]; }

    // The state of a path, to put back if an apply fails part way:
    // through the merged path while mounted, else in upper/.
    function snapshot(p) {
        if (isMounted(mountOf(p))) return { mounted: true, file: readOrNull(P(p)) };
        var u = upper(p);
        return { mounted: false, whiteout: whiteout.is(u), file: whiteout.is(u) ? null : readOrNull(u) };
    }
    function restore(p, snap) {
        if (snap.mounted) {
            if (snap.file) writeAtomic(P(p), snap.file.data, snap.file.mode);
            else unlinkIfThere(P(p));
            return Promise.resolve();
        }
        var u = upper(p);
        unlinkIfThere(u);
        if (snap.file) writeAtomic(u, snap.file.data, snap.file.mode);
        return snap.whiteout ? whiteout.make(u) : Promise.resolve();
    }

    return {
        kind: "device",
        dir: base,
        mounted: function () { return MOUNTS.filter(isMounted); },
        isMounted: function (p) { return isMounted(mountOf(p)); },
        snapshot: snapshot,
        restore: restore,
        write: function (p, data, mode) {
            if (isMounted(mountOf(p))) { writeAtomic(P(p), data, mode); return Promise.resolve(); }
            var u = upper(p);
            unlinkIfThere(u);       // a whiteout from an earlier removal
            writeAtomic(u, data, mode);
            return Promise.resolve();
        },
        remove: function (p) {
            if (isMounted(mountOf(p))) { unlinkIfThere(P(p)); return Promise.resolve(); }
            var u = upper(p);
            unlinkIfThere(u);
            // Only the image's file needs hiding: one only a bundle added is
            // simply gone from upper/.
            if (!exists(P(p))) return Promise.resolve();
            fs.mkdirSync(path.dirname(u), { recursive: true, mode: 0o755 });
            return whiteout.make(u);
        },
        // The image's copy ({data, mode}) or null.
        image: function (p) {
            return isMounted(mountOf(p)) ? readOrNull(P(LOWER + p)) : readOrNull(P(p));
        },
        // The file back as the image has it (4.6): its copy written through
        // the merged path (also taking a whiteout away), or, when the image
        // has none, the file unlinked (it was only in upper/, so no whiteout
        // is left). Unmounted: upper/'s entry deleted.
        revert: function (p) {
            if (!isMounted(mountOf(p))) { unlinkIfThere(upper(p)); return Promise.resolve(); }
            var img = readOrNull(P(LOWER + p));
            if (img) writeAtomic(P(p), img.data, img.mode);
            else unlinkIfThere(P(p));
            return Promise.resolve();
        },
        // Mounts the overlay on each of mounts not mounted yet whose upper/
        // has something: the image's directory bind-mounted at LOWER, the
        // overlay over the mount point, the refused paths bound back.
        mount: function (mounts) {
            var todo = mounts.filter(function (m) { return !isMounted(m) && exists(upper(m)); });
            return todo.reduce(function (chain, m) {
                return chain.then(function () { return mountOne(run, root, base, m); });
            }, Promise.resolve()).then(function () { return todo; });
        }
    };
}

function mountOne(run, root, base, m) {
    var lower = LOWER + m;
    fs.mkdirSync(path.join(root, lower), { recursive: true, mode: 0o755 });
    fs.mkdirSync(path.join(base, "upper", m), { recursive: true, mode: 0o755 });
    fs.mkdirSync(path.join(base, "work", m), { recursive: true, mode: 0o700 });
    var upperDir = base.slice(root.replace(/\/$/, "").length) + "/upper" + m;
    var workDir = base.slice(root.replace(/\/$/, "").length) + "/work" + m;
    var steps = [
        ["mount", ["--bind", m, lower]],
        ["mount", ["-t", "overlay", "overlay", "-o", "lowerdir=" + lower + ",upperdir=" + upperDir + ",workdir=" + workDir, m]]
    ];
    // Read before anything is mounted: the image's own files.
    refusedInside(m).concat(refusedFilesIn(root, m)).forEach(function (r) {
        if (exists(path.join(root, r))) steps.push(["mount", ["--bind", LOWER + r, r]]);
    });
    return steps.reduce(function (chain, s) { return chain.then(function () { return run(s[0], s[1]); }); }, Promise.resolve());
}

// The simulator's overlay: dir is laid out like the device's root.
function createDirectOverlay(opts) {
    var dir = opts.dir;
    var F = function (p) { return path.join(dir, p); };
    var WH = function (p) { return path.join(dir, path.dirname(p), ".wh." + path.basename(p)); };
    return {
        kind: "direct",
        dir: dir,
        mounted: function () { return MOUNTS.slice(); },
        isMounted: function () { return true; },
        snapshot: function (p) { return { file: readOrNull(F(p)), whiteout: exists(WH(p)) }; },
        restore: function (p, snap) {
            unlinkIfThere(F(p));
            unlinkIfThere(WH(p));
            if (snap.file) writeAtomic(F(p), snap.file.data, snap.file.mode);
            if (snap.whiteout) writeAtomic(WH(p), "", 0o644);
            return Promise.resolve();
        },
        write: function (p, data, mode) { unlinkIfThere(WH(p)); writeAtomic(F(p), data, mode); return Promise.resolve(); },
        remove: function (p) { unlinkIfThere(F(p)); writeAtomic(WH(p), "", 0o644); return Promise.resolve(); },
        image: function (p) { return opts.image ? opts.image(p) : null; },
        revert: function (p) { unlinkIfThere(F(p)); unlinkIfThere(WH(p)); return Promise.resolve(); },
        mount: function () { return Promise.resolve([]); }
    };
}

// ---- At boot (P3's phoenix-overlay.service runs boot.js) --------------------------------

// What to do at boot, before the hub, WebAppMgr and luna-surfacemanager
// start (4.2, 4.6): {clear: bool (Revert to Image asked for it: the whole
// overlay folder goes), mount: [mount points], drop: [upper files left
// behind by reverts], why}. opts: {root, devMode, build}.
function bootPlan(opts) {
    var root = opts.root;
    var dir = path.join(root, OVERLAY);
    var state = null;
    try { state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")); } catch (e) { state = null; }
    if (!state) return { clear: false, mount: [], drop: [], why: "no overlay" };
    if (state.clear) return { clear: true, mount: [], drop: [], why: "Revert to Image" };
    if (!opts.devMode) return { clear: false, mount: [], drop: [], why: "Developer Mode is off" };
    if (state.build !== opts.build) return { clear: false, mount: [], drop: [], why: "made for build " + state.build + ", not " + opts.build };
    var files = state.files || {}, removed = state.removed || {};
    var mounts = MOUNTS.filter(function (m) {
        return Object.keys(files).concat(Object.keys(removed)).some(function (p) { return p.indexOf(m + "/") === 0; });
    });
    if (!mounts.length) return { clear: false, mount: [], drop: [], why: "the overlay is empty" };
    // What upper/ holds that the state does not list: copies a revert wrote
    // while mounted (the image's file, copied up) and whiteouts it replaced.
    var drop = [];
    var upperBase = path.join(dir, state.build, "upper");
    (function walk(d, rel) {
        var names;
        try { names = fs.readdirSync(d); } catch (e) { return; }
        names.forEach(function (n) {
            var full = path.join(d, n), p = rel + "/" + n, st = fs.lstatSync(full);
            if (st.isDirectory()) return walk(full, p);
            if (!files[p] && !removed[p]) drop.push(p);
        });
    })(upperBase, "");
    return { clear: false, mount: mounts, drop: drop.sort(), why: "mounting" };
}

module.exports = { OVERLAY: OVERLAY, LOWER: LOWER, MOUNTS: MOUNTS, mountedOverlays: mountedOverlays, createDeviceOverlay: createDeviceOverlay,
                   createDirectOverlay: createDirectOverlay, mountOne: mountOne, bootPlan: bootPlan, refusedInside: refusedInside };
