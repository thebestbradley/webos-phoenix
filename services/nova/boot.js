#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The developer overlay at boot (docs/DEV-PUSH.md 4.2, 4.6): what P3's
// phoenix-overlay.service (Type=oneshot, after /var is mounted, before the
// Luna hub, WebAppMgr and luna-surfacemanager) runs:
//
//   node /usr/palm/services/org.webosphoenix.nova/boot.js [--root DIR] [--dry-run]
//
// Revert to Image asked for: the whole overlay folder deleted. Otherwise,
// only with Developer Mode on (its flag file, read directly: the bus is not
// up yet), an overlay made for this BUILD_ID and something in it: the
// copies reverts left behind dropped from upper/, then each mount point
// with changes mounted (lib/overlay.js mountOne: the image's directory
// bind-mounted for reverts, the overlay, the refused paths bound back).
// Otherwise nothing is mounted and the device runs exactly its image.

"use strict";

var fs = require("fs");
var path = require("path");
var overlay = require("./lib/overlay");
var nova = require("./novaservice");

function osBuild(root) {
    try {
        var m = /^BUILD_ID=(.*)$/m.exec(fs.readFileSync(path.join(root, "etc/os-release"), "utf8"));
        return m ? m[1].trim().replace(/^"(.*)"$/, "$1") : null;
    } catch (e) { return null; }
}

// opts: {root, run(cmd, args) -> Promise, dryRun, log} -> Promise<plan>
function boot(opts) {
    var root = opts.root || "/";
    var log = opts.log || function () {};
    var devMode = fs.existsSync(path.join(root, nova.DEVMODE_FLAG));
    var plan = overlay.bootPlan({ root: root, devMode: devMode, build: osBuild(root) });
    log("developer overlay: " + plan.why);
    if (opts.dryRun) return Promise.resolve(plan);
    if (plan.clear) {
        fs.rmSync(path.join(root, overlay.OVERLAY), { recursive: true, force: true });
        return Promise.resolve(plan);
    }
    if (!plan.mount.length) return Promise.resolve(plan);
    var state = JSON.parse(fs.readFileSync(path.join(root, overlay.OVERLAY, "state.json"), "utf8"));
    var base = path.join(root, overlay.OVERLAY, String(state.build || ""));
    plan.drop.forEach(function (p) { fs.rmSync(path.join(base, "upper", p), { force: true }); });
    return plan.mount.reduce(function (chain, m) {
        return chain.then(function () { return overlay.mountOne(opts.run, root, base, m); });
    }, Promise.resolve()).then(function () { return plan; });
}

module.exports = { boot: boot };

if (require.main === module) {
    var args = process.argv.slice(2);
    var rootIdx = args.indexOf("--root");
    boot({ root: rootIdx >= 0 ? args[rootIdx + 1] : "/", dryRun: args.indexOf("--dry-run") >= 0,
           run: require("./lib/system").run, log: function (m) { console.log(m); } })
        .then(function (p) { if (args.indexOf("--dry-run") >= 0) console.log(JSON.stringify(p)); },
              function (e) { console.error("phoenix-overlay: " + e.message); process.exitCode = 1; });
}
