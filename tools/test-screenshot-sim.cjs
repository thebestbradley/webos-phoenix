#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim --screenshot takes its picture once the scene is there:
// --delay counts from the frame after the start-up has made its scene
// (sim.qml's sceneReady), not from the start. From the start, a fresh
// HOME's first run on a software rasteriser (llvmpipe compiling its
// shaders) took the picture before the scene, on the lock screen.
//
//   1. --scene launcher with a fresh HOME and --delay 1000: the launcher;
//   2. --scene firstuse: First Use, not the lock screen;
//   3. the launcher again with every core busy: animations run on the
//      clock with --screenshot (Qt Quick's simple animation driver), so
//      the lock screen's fade is over though few frames are drawn.
//
// Linux, under a display:
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-screenshot-sim.cjs
//       [--sim build/phoenix-sim] [--out DIR]

"use strict";
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "screenshot-sim-tests")));

let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed++; };

// An 8-bit RGB or RGBA PNG, not interlaced (what Qt writes): its pixels.
function readPng(file) {
    const buf = fs.readFileSync(file);
    let pos = 8, width = 0, height = 0, channels = 0;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === "IHDR") {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4);
            if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 2 && data[9] !== 6))
                throw new Error(`${file}: not an 8-bit RGB(A) PNG`);
            channels = data[9] === 6 ? 4 : 3;
        } else if (type === "IDAT") {
            idat.push(data);
        }
        pos += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels, px = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? px[y * stride + x - channels] : 0;
            const b = y > 0 ? px[(y - 1) * stride + x] : 0;
            const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
            let v = line[x];
            if (f === 1) v += a;
            else if (f === 2) v += b;
            else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            px[y * stride + x] = v & 255;
        }
    }
    return { width, height, at: (x, y) => { const i = y * stride + x * channels; return [px[i], px[i + 1], px[i + 2]]; } };
}

let lastLog = "";
function shoot(name, simArgs, env) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-shot-"));
    const file = path.join(outDir, name + ".png");
    try {
        const r = spawnSync(SIM, [...simArgs, "--quiet", "--no-marketplace", "--screenshot", file],
            { env: { ...process.env, ...env, HOME: home, QTWEBENGINE_DISABLE_SANDBOX: "1" }, encoding: "utf8", timeout: 180000 });
        lastLog = (r.stdout || "") + (r.stderr || "");
        check(r.status === 0, `${name}: phoenix-sim took its screenshot (exit ${r.status}${r.signal ? ", " + r.signal : ""})`);
        return fs.existsSync(file) ? readPng(file) : null;
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
}

// The lock screen's padlock: its gold, at the middle of the screen's lower
// part (LockScreen.qml, padlock.homeY).
function padlockShown(img) {
    for (let y = Math.round(img.height * 0.6); y < img.height * 0.9; y += 2) {
        const [r, g, b] = img.at(Math.round(img.width / 2), y);
        if (r > 180 && g > 140 && b < 90) return true;
    }
    return false;
}

if (process.platform !== "linux") {
    console.log("skip: run under xvfb on Linux");
    process.exit(0);
}
if (!fs.existsSync(SIM)) {
    console.error(`${SIM} is missing: build it first (cmake --build build)`);
    process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

// 1. The launcher, a second after the scene is up: its grey page (#353b41
// behind the icons), not the lock screen.
const launcher = shoot("launcher", ["--phone", "--scene", "launcher", "--delay", "1000"]);
if (launcher) {
    const [r, g, b] = launcher.at(150, 300);
    check(Math.abs(r - 0x35) < 12 && Math.abs(g - 0x3b) < 12 && Math.abs(b - 0x41) < 12 && !padlockShown(launcher),
        `launcher: the launcher's page shows, not the lock screen (rgb ${r},${g},${b} at 150,300)`);
}

// 2. First Use from a fresh HOME: its card, not the lock screen's padlock.
const firstUse = shoot("firstuse", ["--phone", "--scene", "firstuse", "--delay", "1000"]);
if (firstUse)
    check(!padlockShown(firstUse), "firstuse: First Use shows, not the lock screen");

// 3. As 1, with every core kept busy twice over meanwhile; and the
// animations on the clock (Qt Quick says which driver it uses).
const busy = os.cpus().concat(os.cpus()).map(() => spawn(process.execPath, ["-e", "for (;;) {}"], { stdio: "ignore" }));
try {
    const loaded = shoot("launcher-busy", ["--phone", "--scene", "launcher", "--delay", "1000"], { QSG_INFO: "1" });
    check(/Animation Driver: using QElapsedTimer/.test(lastLog) && !/Animation Driver: using vsync/.test(lastLog),
        "every core busy: the animations run on the clock (QSG_INFO: Animation Driver: using QElapsedTimer)");
    if (loaded) {
        const [r, g, b] = loaded.at(150, 300);
        check(Math.abs(r - 0x35) < 12 && Math.abs(g - 0x3b) < 12 && Math.abs(b - 0x41) < 12 && !padlockShown(loaded),
            `launcher, every core busy: the launcher's page shows, the lock screen faded (rgb ${r},${g},${b} at 150,300)`);
    }
} finally {
    busy.forEach((p) => p.kill());
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
