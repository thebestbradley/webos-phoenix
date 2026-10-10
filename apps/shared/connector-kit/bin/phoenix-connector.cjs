#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-connector new | validate | pack | test (src/tools/cli.ts;
// docs/SYNERGY-SDK.md). Build the kit first: npm run build -w @phoenix/connector-kit.

"use strict";

let cli;
try {
    cli = require("../lib/tools/cli.js");
} catch (e) {
    console.error("phoenix-connector: the kit is not built (cd apps && npm run build -w @phoenix/connector-kit): " + e.message);
    process.exit(2);
}
cli.main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error("phoenix-connector: " + (e && e.stack || e));
    process.exit(2);
});
