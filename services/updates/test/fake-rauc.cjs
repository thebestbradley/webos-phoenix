#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for RAUC's command line in the tests (lib/node.js calls it as
// it calls rauc): the same commands and JSON shapes, two rootfs slots kept
// in $FAKE_RAUC_STATE. A "bundle" is its manifest as text ([update]
// compatible, version, build); one starting with "BAD" fails the signature
// check, as RAUC refuses a bundle not signed for its keyring.
//
// The service runs several of these at once (a status while another
// command works), so only the commands that change the slots write the
// state, read just before they change it; every call is appended to
// $FAKE_RAUC_STATE.calls, one per line. A read-only command that wrote the
// whole state back could undo a change made while it ran.

"use strict";
const fs = require("fs");

const file = process.env.FAKE_RAUC_STATE;
let st = JSON.parse(fs.readFileSync(file, "utf8"));
const change = (fn) => {
    st = JSON.parse(fs.readFileSync(file, "utf8"));
    fn();
    const tmp = file + "." + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(st));
    fs.renameSync(tmp, file);
};
const other = () => (st.booted === "rootfs.0" ? "rootfs.1" : "rootfs.0");
const args = process.argv.slice(2);
fs.appendFileSync(file + ".calls", args.join(" ") + "\n");

function manifest(path) {
    const text = fs.readFileSync(path, "utf8");
    if (text.startsWith("BAD")) {
        process.stderr.write("rauc-Message: Failed to verify bundle signature: signature verification failed\n");
        process.exit(1);
    }
    const m = {};
    let section = "";
    for (const line of text.split("\n")) {
        const sec = /^\[(.+)\]$/.exec(line.trim()), kv = /^(\w+)=(.*)$/.exec(line.trim());
        if (sec) section = sec[1];
        else if (kv && section === "update") m[kv[1]] = kv[2];
    }
    return m;
}

if (args[0] === "status" && args[1] === "--output-format=json") {
    const slot = (name) => ({ [name]: { class: "rootfs", device: "/dev/mmcblk0p" + (name === "rootfs.0" ? 2 : 3), type: "ext4",
        bootname: name === "rootfs.0" ? "A" : "B", state: name === st.booted ? "booted" : "inactive", parent: null,
        mountpoint: name === st.booted ? "/" : null, boot_status: "good" } });
    process.stdout.write(JSON.stringify({ compatible: st.compatible, variant: "", booted: st.booted === "rootfs.0" ? "A" : "B",
        boot_primary: st.primary, slots: [slot("rootfs.0"), slot("rootfs.1"), { "bootloader.0": { class: "bootloader", state: "inactive" } }] }) + "\n");
} else if (args[0] === "status" && args[1] === "mark-active") {
    change(() => { st.primary = args[2] === "booted" ? st.booted : args[2] === "other" ? other() : args[2]; });
    process.stdout.write("rauc status: marked slot " + st.primary + " as active\n");
} else if (args[0] === "info" && args[1] === "--output-format=json") {
    const m = manifest(args[2]);
    process.stdout.write(JSON.stringify({ compatible: m.compatible, version: m.version, description: "", build: m.build, hooks: [], images: [] }) + "\n");
} else if (args[0] === "install") {
    const m = manifest(args[1]);
    if (m.compatible !== st.compatible) {
        process.stderr.write("Compatible mismatch: Expected '" + st.compatible + "' but bundle manifest has '" + m.compatible + "'\n");
        process.exit(1);
    }
    for (const [pct, msg] of [[0, "Installing"], [20, "Checking bundle done."], [40, "Copying image to rootfs"], [80, "Copying image to rootfs done."], [100, "Installing done."]])
        process.stdout.write(String(pct).padStart(3) + "% " + msg + "\n");
    change(() => {
        st.slots[other()] = { version: m.version, build: Number(m.build) };
        st.primary = other();
    });
    process.stdout.write("idle\nInstalling `" + args[1] + "` succeeded\n");
} else {
    process.stderr.write("fake rauc: unknown command " + args.join(" ") + "\n");
    process.exit(2);
}
