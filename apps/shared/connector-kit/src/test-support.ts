// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// For tests: a connector's CommonJS files loaded as the simulator's service
// loader loads them (relative requires from its own folder), with the kit
// and the sync layer given as the modules the test already has (their
// sources, so the tests need no build). Anything else is Node's require.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import * as kit from "./index";
import * as synckit from "@phoenix/synckit";

export function loadCommonJs(file: string, provided?: Record<string, unknown>): any {
    const given: Record<string, unknown> = Object.assign({ "@phoenix/connector-kit": kit, "@phoenix/synckit": synckit }, provided || {});
    const cache: Record<string, { exports: any }> = {};
    function load(path: string): any {
        if (cache[path]) return cache[path].exports;
        const module = { exports: {} as any };
        cache[path] = module;
        const nodeRequire = createRequire(path);
        const req = (name: string) => {
            if (name in given) return given[name];
            if (name.charAt(0) === ".") {
                const full = resolve(dirname(path), name);
                return load(/\.(c?js|json)$/.test(full) ? full : full + ".js");
            }
            return nodeRequire(name);
        };
        if (/\.json$/.test(path)) module.exports = JSON.parse(readFileSync(path, "utf8"));
        else new Function("module", "exports", "require", "__dirname", "__filename", readFileSync(path, "utf8"))(module, module.exports, req, dirname(path), path);
        return module.exports;
    }
    return load(resolve(file));
}
