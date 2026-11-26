// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Stand-ins for what novad runs on a device (lib/system.js run), for the
// tests: every call is recorded, and mount and mknod do to the fake root
// what the kernel would show through it:
//
//   mount --bind SRC DST          DST becomes a copy of SRC as it is now
//                                 (the image's directory at
//                                 /run/phoenix/overlay/lower/..., or a
//                                 refused path put back from there)
//   mount -t overlay ... -o lowerdir=,upperdir=U,workdir= M
//                                 U's files are laid over M, its whiteouts
//                                 delete; "overlay M overlay ..." goes into
//                                 <root>/proc/mounts, so novad sees it
//                                 mounted and writes through M from then on
//   mknod F c 0 0                 an overlayfs whiteout: here a file whose
//                                 bytes say so (whiteout.is)
//   systemctl, ls-control, pkill  recorded; pkill exits 1 (nothing ran)
//
// failOn(cmd) makes the next such command fail.

"use strict";

const fs = require("fs");
const path = require("path");

const WHITEOUT = "\0overlayfs whiteout 0/0\0";

function createFakeSystem(root) {
    const calls = [];
    const failing = new Set();
    const R = (p) => path.join(root, p);
    function copyTree(src, dst) {
        if (!fs.existsSync(src)) return;
        const st = fs.statSync(src);
        if (st.isDirectory()) {
            fs.mkdirSync(dst, { recursive: true });
            for (const n of fs.readdirSync(src)) copyTree(path.join(src, n), path.join(dst, n));
        } else {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            fs.chmodSync(dst, st.mode & 0o777);
        }
    }
    function isWhiteout(f) {
        try { return fs.readFileSync(f, "utf8") === WHITEOUT; } catch (e) { return false; }
    }
    function layer(upper, mount) {
        (function walk(d, rel) {
            if (!fs.existsSync(d)) return;
            for (const n of fs.readdirSync(d)) {
                const full = path.join(d, n), p = rel + "/" + n;
                if (fs.statSync(full).isDirectory()) walk(full, p);
                else if (isWhiteout(full)) fs.rmSync(R(mount + p), { force: true });
                else copyTree(full, R(mount + p));
            }
        })(upper, "");
    }
    function run(cmd, args) {
        calls.push([cmd].concat(args).join(" "));
        if (failing.has(cmd)) {
            failing.delete(cmd);
            return Promise.reject(Object.assign(new Error(cmd + " failed (a test said so)"), { exitCode: 2 }));
        }
        if (cmd === "mount" && args[0] === "--bind") {
            fs.rmSync(R(args[2]), { recursive: true, force: true });
            copyTree(R(args[1]), R(args[2]));
        } else if (cmd === "mount" && args[0] === "-t" && args[1] === "overlay") {
            const o = {};
            args[4].split(",").forEach((kv) => { const i = kv.indexOf("="); o[kv.slice(0, i)] = kv.slice(i + 1); });
            layer(R(o.upperdir), args[5]);
            fs.mkdirSync(R("/proc"), { recursive: true });
            fs.appendFileSync(R("/proc/mounts"), `overlay ${args[5]} overlay rw,lowerdir=${o.lowerdir},upperdir=${o.upperdir},workdir=${o.workdir} 0 0\n`);
        } else if (cmd === "mknod") {
            fs.mkdirSync(path.dirname(args[0]), { recursive: true });
            fs.writeFileSync(args[0], WHITEOUT);
        } else if (cmd === "pkill") {
            return Promise.reject(Object.assign(new Error("pkill: no process"), { exitCode: 1 }));
        }
        return Promise.resolve({ stdout: "" });
    }
    return {
        calls,
        run,
        whiteout: { make: (f) => run("mknod", [f, "c", "0", "0"]), is: isWhiteout },
        failOn: (cmd) => failing.add(cmd),
        reset: () => { calls.length = 0; },
    };
}

module.exports = { createFakeSystem, WHITEOUT };
