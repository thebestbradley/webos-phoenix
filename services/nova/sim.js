#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// novad for the simulator (docs/DEV-PUSH.md 2, "nova push --device sim";
// 11): the device's own code (novaservice.js, lib/proto.js) over the
// simulator's data folder, so `nova pair -d sim` and `nova push -d sim`
// work against a running phoenix-sim (or tools/serve-rootfs.py) as they do
// against a device, without hardware.
//
//   node services/nova/sim.js --data DIR [--repo DIR] [--instance NAME] [--port N]
//   node services/nova/sim.js --data DIR --boot-only    (the boot step alone)
//
// DIR is the simulator's data folder, laid out like a device's / where it
// keeps its own (phoenix-sim's AppDataLocation; serve-rootfs.py's
// --installed-dir/data): /var/luna/ there is what the pages read as
// /var/luna/. What differs from a device:
//
// - The image is the checkout the simulator runs (--repo): its manifest is
//   tools/install-rootfs.py --print-manifest, build "sim", compatible
//   "phoenix-sim", made once at start. nova push builds from another
//   checkout (a worktree) against it.
// - The overlay is a folder, <DIR>/var/lib/phoenix/overlay/sim/upper, which
//   phoenix-sim and serve-rootfs.py read before the checkout while
//   <DIR>/var/lib/phoenix/overlay/sim/active exists (lib/overlay.js
//   createDirectOverlay); at start this does what the boot script does on a
//   device (Revert to Image clears it; Developer Mode off takes the marker
//   away).
// - Restarts are asked of the simulator: <DIR>/var/luna/nova/restart.json
//   ({seq, restart: [...]}), which phoenix-sim acts on (it restarts itself,
//   opening the app a bundle changed) and the tests read.
// - Developer Mode is the simulator's (its pages' setting): the runtime's
//   org.webosphoenix.nova tells it (POST /sim/devmode), and it keeps
//   <DIR>/var/luna/preferences/devmode_enabled as a device's provider would.
// - Settings talks to it through the runtime (runtime/phoenix-runtime.js,
//   org.webosphoenix.nova): a plain HTTP server on 127.0.0.1 with a random
//   token (POST /luna/<method>), written with the TLS port to
//   <DIR>/var/luna/nova/sim.json for the pages, and to
//   ~/.config/nova/sims/<instance or "default">.json for nova -d sim.
//
// It stops when its parent does (phoenix-sim starts it; a test kills it).

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var childProcess = require("child_process");

// In a checkout, the packages a device copies into the service's
// node_modules (@phoenix/platform, @noble/curves) are apps/node_modules',
// as Node finds them with NODE_PATH.
(function nodePath() {
    var nm = path.resolve(__dirname, "../../apps/node_modules");
    var paths = (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
    if (fs.existsSync(nm) && paths.indexOf(nm) < 0) {
        process.env.NODE_PATH = [nm].concat(paths).join(path.delimiter);
        require("module")._initPaths();
    }
})();

var nova = require("./novaservice");
var proto = require("./lib/proto");
var overlayLib = require("./lib/overlay");

var REPO_DEFAULT = path.resolve(__dirname, "../..");
var BUILD = "sim";

function args(argv) {
    var o = {};
    for (var i = 0; i < argv.length; i++) {
        var m = /^--([a-z-]+)$/.exec(argv[i]);
        if (!m) continue;
        // A switch (--boot-only) has no value.
        if (i + 1 >= argv.length || /^--/.test(argv[i + 1])) o[m[1]] = true;
        else o[m[1]] = argv[++i];
    }
    return o;
}

function configDir() {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "nova");
}

// What the boot script does on a device (4.2, 4.6): Revert to Image clears
// the overlay, Developer Mode off (or another build's) takes the marker
// away, else the marker is made. phoenix-sim runs it (--boot-only) before it
// picks the shell's QML (simnova.h), as a device's boot does before
// luna-surfacemanager starts; start() again (it is idempotent). -> the plan
function boot(dataDir) {
    var data = path.resolve(dataDir);
    var D = function (p) { return path.join(data, p); };
    var activeMarker = D(overlayLib.OVERLAY + "/" + BUILD + "/active");
    var plan = overlayLib.bootPlan({ root: data, devMode: fs.existsSync(D(nova.DEVMODE_FLAG)), build: BUILD });
    if (plan.clear) fs.rmSync(D(overlayLib.OVERLAY), { recursive: true, force: true });
    else if (plan.mount.length) fs.writeFileSync(activeMarker, "");
    else fs.rmSync(activeMarker, { force: true });
    return plan;
}

// opts: {data, repo, instance, port (TLS; 0 for any), log} -> Promise<{core,
// port, lunaPort, token, close()}>
function start(opts) {
    var data = path.resolve(opts.data);
    var repo = path.resolve(opts.repo || REPO_DEFAULT);
    var log = opts.log || function (m) { console.log("[nova-sim] " + m); };
    var D = function (p) { return path.join(data, p); };
    var overlayDir = D(overlayLib.OVERLAY + "/" + BUILD);
    var activeMarker = path.join(overlayDir, "active");
    var restartFile = D("/var/luna/nova/restart.json");
    var seq = 0;

    // The checkout's manifest, as the image's (P1's --print-manifest).
    var manifestCache = null;
    function manifest() {
        if (manifestCache) return manifestCache;
        var r = childProcess.spawnSync(process.env.PYTHON || "python3",
            [path.join(REPO_DEFAULT, "tools/install-rootfs.py"), "--repo", repo, "--print-manifest"], { maxBuffer: 1 << 28 });
        if (r.status !== 0) { log("manifest: " + String(r.stderr).trim()); return null; }
        var m = JSON.parse(String(r.stdout));
        delete m.unbuilt;
        m.build = BUILD;
        m.compatible = "phoenix-sim";
        manifestCache = m;
        return m;
    }
    // A file as the simulator serves it: the overlay's, else the checkout's
    // (laid out by install-rootfs.py as the image would hold it).
    function readFile(p) {
        var f = path.join(overlayDir, "upper", p);
        if (fs.existsSync(path.join(path.dirname(f), ".wh." + path.basename(f)))) throw Object.assign(new Error("No file " + p), { code: "NOT_FOUND" });
        if (fs.existsSync(activeMarker) && fs.existsSync(f)) return fs.readFileSync(f);
        var stage = fs.mkdtempSync(path.join(os.tmpdir(), "nova-sim-get-"));
        try {
            var r = childProcess.spawnSync(process.env.PYTHON || "python3",
                [path.join(REPO_DEFAULT, "tools/install-rootfs.py"), "--repo", repo, stage, "--only", "-"], { input: p + "\n" });
            var out = path.join(stage, p);
            if (r.status !== 0 || !fs.existsSync(out)) throw Object.assign(new Error("No file " + p), { code: "NOT_FOUND" });
            return fs.readFileSync(out);
        } finally { fs.rmSync(stage, { recursive: true, force: true }); }
    }
    function requestRestart(list) {
        seq = Math.max(seq + 1, Date.now());
        fs.mkdirSync(path.dirname(restartFile), { recursive: true });
        fs.writeFileSync(restartFile + ".new", JSON.stringify({ seq: seq, restart: list }) + "\n");
        fs.renameSync(restartFile + ".new", restartFile);
    }
    var pending = [], flush = null;
    // One request for every restart a change asks for, sent once they are all in.
    function restart(what) {
        pending.push(what);
        if (!flush) flush = setTimeout(function () { var l = pending; pending = []; flush = null; requestRestart(l); }, 50);
        return Promise.resolve();
    }

    log("developer overlay: " + boot(data).why);
    // The account nova term logs in as: an image has its home
    // (phoenix-pty_git.bb USERADD_PARAM: --home-dir /home/user
    // --create-home), so novaservice's authorizedKeys() makes ~/.ssh 0700
    // and authorized_keys 0600, owned by the home's owner, here as there
    // (docs/SIM-PARITY.md). Without it the simulator wrote nothing and
    // never ran that code.
    fs.mkdirSync(D("/home/user"), { recursive: true, mode: 0o755 });

    var core = nova.createNova({
        root: data, build: BUILD, manifest: manifest, readFile: readFile, restart: restart,
        overlay: function (build) {
            return overlayLib.createDirectOverlay({ dir: path.join(data, overlayLib.OVERLAY, build, "upper"),
                                                    active: path.join(data, overlayLib.OVERLAY, build, "active") });
        },
        run: function (cmd, a) {
            if (cmd === "systemctl" && a[0] === "reboot") return restart("reboot");
            return Promise.resolve({ stdout: "" });
        },
        luna: { call: function () { return Promise.resolve({ returnValue: true }); } },
        // The simulator's own passcode is its pages' (Settings asked it before calling).
        matchPasscode: function () { return Promise.resolve(true); },
        log: log
    });

    var token = crypto.randomBytes(18).toString("base64url");
    var tlsServer = proto.createServer(core, { host: "127.0.0.1", port: opts.port === undefined ? 0 : opts.port, name: "webOS Phoenix simulator",
                                               onError: log });
    var luna = http.createServer(function (req, res) {
        function send(code, obj) {
            res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify(obj));
        }
        if (req.method !== "POST" || req.headers["x-nova-token"] !== token) return send(403, { returnValue: false, errorText: "forbidden" });
        var body = "";
        req.on("data", function (c) { body += c; if (body.length > 1 << 20) req.destroy(); });
        req.on("end", function () {
            var p;
            try { p = body ? JSON.parse(body) : {}; } catch (e) { return send(400, { returnValue: false, errorText: "not JSON" }); }
            var m = /^\/luna\/([A-Za-z]+)$/.exec(req.url);
            if (req.url === "/sim/devmode") {
                if (p.on) { fs.mkdirSync(path.dirname(D(nova.DEVMODE_FLAG)), { recursive: true }); fs.writeFileSync(D(nova.DEVMODE_FLAG), ""); }
                else fs.rmSync(D(nova.DEVMODE_FLAG), { force: true });
                core.changed();
                return send(200, { returnValue: true });
            }
            if (!m || nova.METHODS.indexOf(m[1]) < 0) return send(404, { returnValue: false, errorText: "no such method" });
            core.methods[m[1]](p).then(function (r) { send(200, r); });
        });
    });
    var lunaListening = new Promise(function (resolve, reject) {
        luna.once("error", reject);
        luna.listen(0, "127.0.0.1", function () { resolve(luna.address().port); });
    });
    var simFile = path.join(configDir(), "sims", (opts.instance || "default") + ".json");
    return Promise.all([tlsServer.listening, lunaListening]).then(function (ports) {
        var info = { address: "127.0.0.1", port: ports[0], fingerprint: core.deviceKey().fingerprint, pid: process.pid, data: data, repo: repo };
        fs.mkdirSync(D("/var/luna/nova"), { recursive: true });
        fs.writeFileSync(D("/var/luna/nova/sim.json"), JSON.stringify({ lunaPort: ports[1], token: token, port: ports[0] }) + "\n", { mode: 0o600 });
        fs.mkdirSync(path.dirname(simFile), { recursive: true, mode: 0o700 });
        fs.writeFileSync(simFile, JSON.stringify(info) + "\n", { mode: 0o600 });
        log("listening for nova on 127.0.0.1:" + ports[0]);
        return {
            core: core, port: ports[0], lunaPort: ports[1], token: token, simFile: simFile,
            close: function () {
                try { if (JSON.parse(fs.readFileSync(simFile, "utf8")).pid === process.pid) fs.rmSync(simFile, { force: true }); } catch (e) { /* gone */ }
                luna.close();
                return tlsServer.close();
            }
        };
    });
}

module.exports = { start: start, boot: boot, BUILD: BUILD };

if (require.main === module) {
    var a = args(process.argv.slice(2));
    if (!a.data || a.data === true) { console.error("usage: sim.js --data DIR [--boot-only] [--repo DIR] [--instance NAME] [--port N]"); process.exit(2); }
    if (a["boot-only"]) {
        console.log("[nova-sim] developer overlay: " + boot(a.data).why);
        process.exit(0);
    }
    start({ data: a.data, repo: a.repo, instance: a.instance, port: a.port !== undefined ? Number(a.port) : 0 }).then(function (s) {
        function stop() { s.close().then(function () { process.exit(0); }); }
        process.on("SIGTERM", stop);
        process.on("SIGINT", stop);
        // phoenix-sim's child: gone with it (stdin closes when the parent does).
        if (a.parent === "stdin") { process.stdin.on("end", stop); process.stdin.resume(); }
    }, function (e) { console.error("nova-sim: " + e.message); process.exit(1); });
}
