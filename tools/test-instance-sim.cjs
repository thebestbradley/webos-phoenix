#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Two simulators at once, each its own device (phoenix-sim --instance):
//
//   1. two phoenix-sim started together with --instance one and --instance
//      two both run and take their screenshots;
//   2. each keeps its data (the device's data, QtWebEngine's profiles) in a
//      folder of its own, phoenix-sim-one and phoenix-sim-two, and neither
//      touches the usual phoenix-sim folder: without --instance both would
//      share one device and one web storage, which Chromium does not
//      support from two processes;
//   3. a name that could leave the data folder (../x) is refused, exit 2.
//
// Linux (the folders are XDG's under a fresh HOME):
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-instance-sim.cjs
//       [--sim build/phoenix-sim] [--out DIR]

"use strict";
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "instance-sim-tests")));

let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed++; };

if (process.platform !== "linux") {
    console.log("skip: the data folders checked are Linux's (XDG under HOME)");
    process.exit(0);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-instance-"));
fs.mkdirSync(outDir, { recursive: true });
const env = { ...process.env, HOME: home,
              QTWEBENGINE_DISABLE_SANDBOX: "1" };
for (const k of ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]) delete env[k];

function run(name) {
    const shot = path.join(outDir, name + ".png");
    fs.rmSync(shot, { force: true });
    const child = spawn(SIM, ["--instance", name, "--no-marketplace", "--no-boot-animation", "--quiet",
                              "--launch", "com.palm.app.notes", "--screenshot", shot, "--delay", "6000"],
                        { env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", d => { err += d; });
    return new Promise(resolve => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
        child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ name, code, signal, shot, err }); });
    });
}

(async () => {
    // 1. Both at once: started together, each is up while the other runs.
    const [one, two] = await Promise.all([run("one"), run("two")]);
    for (const r of [one, two]) {
        check(r.code === 0, `--instance ${r.name}: exits 0 (got ${r.code}${r.signal ? ", " + r.signal : ""})`);
        check(fs.existsSync(r.shot) && fs.statSync(r.shot).size > 1000, `--instance ${r.name}: its screenshot was saved`);
        if (r.code !== 0) console.log(r.err.split("\n").slice(-6).join("\n"));
    }

    // 2. A data folder each, and none shared.
    const data = path.join(home, ".local/share/webos-phoenix");
    for (const name of ["one", "two"]) {
        const dir = path.join(data, "phoenix-sim-" + name);
        check(fs.existsSync(dir), `phoenix-sim-${name}: its own data folder`);
        check(fs.existsSync(path.join(dir, "QtWebEngine", "phoenix-sim")), `phoenix-sim-${name}: its own web storage (QtWebEngine/phoenix-sim)`);
    }
    check(!fs.existsSync(path.join(data, "phoenix-sim")), "the usual phoenix-sim folder is not touched");

    // 3. A name that would leave the data folder.
    const bad = spawnSync(SIM, ["--instance", "../x", "--screenshot", path.join(outDir, "bad.png")],
                          { env, encoding: "utf8", timeout: 60000 });
    check(bad.status === 2, `--instance ../x: refused, exit 2 (got ${bad.status})`);
    check(/--instance \.\.\/x/.test(bad.stderr || ""), "--instance ../x: says why");

    fs.rmSync(home, { recursive: true, force: true });
    console.log(failed ? `${failed} failed` : "all passed");
    process.exit(failed ? 1 : 0);
})();
