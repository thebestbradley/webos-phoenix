// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Starts a throwaway WsgiDAV WebDAV server (pip install wsgidav cheroot) on
// 127.0.0.1, serving a temporary folder to one user with Basic auth, for
// the backup tests (backupservice.test.ts, tools/test-backup.cjs).

"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");

function available() {
    return spawnSync("python3", ["-c", "import wsgidav, cheroot"], { stdio: "ignore" }).status === 0;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => { const p = srv.address().port; srv.close(() => resolve(p)); });
        srv.on("error", reject);
    });
}

async function start(options) {
    options = options || {};
    const user = options.user || "alice", password = options.password || "wonderland-app-password";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-wsgidav-"));
    const root = path.join(dir, "root");
    fs.mkdirSync(root);
    const port = await freePort();
    const config = {
        host: "127.0.0.1", port,
        provider_mapping: { "/": root },
        http_authenticator: { domain_controller: null, accept_basic: true, accept_digest: false, default_to_digest: false },
        simple_dc: { user_mapping: { "*": { [user]: { password } } } },
        verbose: 1, logging: { enable: false }
    };
    fs.writeFileSync(path.join(dir, "wsgidav.json"), JSON.stringify(config));
    const proc = spawn("python3", ["-m", "wsgidav.server.server_cli", "--config", path.join(dir, "wsgidav.json")],
                       { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d; });
    const url = `http://127.0.0.1:${port}`;
    const until = Date.now() + 15000;
    for (;;) {
        try { await fetch(url + "/", { method: "OPTIONS" }); break; } catch (e) { /* not up yet */ }
        if (Date.now() > until || proc.exitCode !== null) throw new Error("WsgiDAV did not start: " + stderr);
        await new Promise((r) => setTimeout(r, 100));
    }
    return {
        url, user, password, root,
        files(sub) {
            const d = path.join(root, sub || "");
            return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
        },
        read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); },
        write(rel, text) { fs.writeFileSync(path.join(root, rel), text); },
        async stop() {
            proc.kill();
            await new Promise((r) => (proc.exitCode !== null ? r() : proc.on("exit", r)));
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

module.exports = { available, start };
