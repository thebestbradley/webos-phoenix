// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// .ipk packages: @phoenix/platform's ipk.js (moved there so that
// org.webosphoenix.nova reads dev bundles with the same code: docs/DEV-PUSH.md
// 12, "What P2 needs from P1"). The Marketplace, the simulator's in-page
// copy (runtime/phoenix-runtime.js loadModule("lib/ipk.js")) and the tools
// that require this file keep doing so.

"use strict";

module.exports = require("@phoenix/platform/src/ipk");
