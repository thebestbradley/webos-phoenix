// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// For tests: a connector's CommonJS files loaded as the simulator's service
// loader loads them (relative requires from its own folder), with the kit
// and the sync layer given as the modules the test already has (their
// sources, so the tests need no build). Anything else is Node's require.

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as kit from "./index";
import * as synckit from "@phoenix/synckit";
import { loadCommonJs as load } from "./tools/load";

export function loadCommonJs(file: string, provided?: Record<string, unknown>): any {
    return load(file, Object.assign({ "@phoenix/connector-kit": kit, "@phoenix/synckit": synckit }, provided || {}));
}
