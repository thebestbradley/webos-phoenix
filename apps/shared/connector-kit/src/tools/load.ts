// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A connector's CommonJS files loaded as the simulator's service loader
// loads them (relative requires from its own folder), with the kit and the
// sync layer given as modules the caller already has, so that
// `phoenix-connector pack` and `validate` read a connector's definition
// (its share declaration) without the connector's own node_modules.
// Anything else is Node's require from the connector's folder.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import * as synckit from "@phoenix/synckit";
import * as kit from "../index";

export function loadCommonJs(file: string, provided: Record<string, unknown>): any {
    const fs = require("fs");
    const p = require("path");
    const { createRequire } = require("module");
    const cache: Record<string, { exports: any }> = {};
    function load(path: string): any {
        if (cache[path]) return cache[path].exports;
        const module = { exports: {} as any };
        cache[path] = module;
        const nodeRequire = createRequire(path);
        const req = (name: string) => {
            if (name in provided) return provided[name];
            if (name.charAt(0) === ".") {
                const full = p.resolve(p.dirname(path), name);
                return load(/\.(c?js|json)$/.test(full) ? full : fs.existsSync(full + ".js") ? full + ".js" : p.join(full, "index.js"));
            }
            return nodeRequire(name);
        };
        if (/\.json$/.test(path)) module.exports = JSON.parse(fs.readFileSync(path, "utf8"));
        else new Function("module", "exports", "require", "__dirname", "__filename", fs.readFileSync(path, "utf8"))(module, module.exports, req, p.dirname(path), path);
        return module.exports;
    }
    return load(p.resolve(file));
}

/** The definition in <dir>/service/connector.js, loaded with this kit. */
export function loadDefinition(dir: string): any {
    const p = require("path");
    return loadCommonJs(p.join(dir, "service", "connector.js"), {
        "@phoenix/connector-kit": kit,
        "@phoenix/synckit": synckit
    });
}
