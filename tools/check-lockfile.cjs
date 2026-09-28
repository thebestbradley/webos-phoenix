#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Checks that apps/package-lock.json lists every platform's optional
// package (rolldown's and lightningcss's native builds, fsevents, ...).
//
// npm drops the other platforms' optional packages when it regenerates a
// lock file on one platform (https://github.com/npm/cli/issues/4828). The
// lock then installs on the machine that wrote it and CI's Linux, but
// `npm ci` on a Mac leaves out @rolldown/binding-darwin-arm64 and the
// build fails with "Cannot find native binding". Regenerate the lock from
// a complete one (`npm install --package-lock-only`), never from scratch.
//
//   node tools/check-lockfile.cjs [path/to/package-lock.json]

"use strict";
const fs = require("fs");
const path = require("path");

const file = process.argv[2] || path.join(__dirname, "..", "apps", "package-lock.json");
const packages = JSON.parse(fs.readFileSync(file, "utf8")).packages || {};

const missing = [];
for (const [where, pkg] of Object.entries(packages)) {
    for (const dep of Object.keys(pkg.optionalDependencies || {})) {
        // Resolved beside the dependent package or at the top.
        const nested = (where ? where + "/" : "") + "node_modules/" + dep;
        if (!(nested in packages) && !(("node_modules/" + dep) in packages))
            missing.push(`${dep} (optional dependency of ${where || "the root"})`);
    }
}

if (missing.length) {
    console.error(`${file}: ${missing.length} optional package(s) missing from the lock:`);
    for (const m of missing)
        console.error("  " + m);
    console.error("It was probably regenerated on one platform (npm/cli#4828); see the note in this script.");
    process.exit(1);
}
console.log(`${file}: every optional package is in the lock`);
