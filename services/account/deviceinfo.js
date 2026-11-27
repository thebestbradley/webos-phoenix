// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What a device tells the Phoenix Account about itself when it registers
// (POST /v1/devices; accountservice.js finishSignIn), from its own files.
// read(path) -> string | null.
//
//   compatible  RAUC's ("compatible=" in /etc/rauc/system.conf). Without
//               RAUC (the VM images, and every image until meta-phoenix has
//               RAUC): "phoenix-<MACHINE>", the machine the image was built
//               for, from /etc/buildinfo (OE's image-buildinfo, "MACHINE =
//               phoenix-vm-arm64"). That is the name the update feeds,
//               system notices and dev push use for a device
//               (docs/DEV-PUSH.md "phoenix-pinephonepro", docs/NOTICES.md
//               "phoenix-vm-arm64"). Only the server's characters
//               ([A-Za-z0-9._-], up to 100).
//   model       the device tree's model. Else, in the VM, the device profile
//               phoenix.device= on /proc/cmdline names
//               (/usr/share/phoenix/devices/device-profiles.json), as
//               Settings > Device Info shows it (services/hardware/lib/
//               systeminfo.js). Else DMI's vendor and product name.
//   name        the model, else "Phoenix device"
//   osVersion   the system's version (/usr/share/phoenix/product.json, as the
//               updates service reports it: "1.0.0"), else /etc/os-release
//               VERSION_ID (LuneOS's on its layers' images, "1.0")
//   build       /etc/os-release BUILD_ID as a number: the image's build
//               (phoenix-devpush.bbclass, its DATETIME, 14 digits), the
//               number the updates service and notices compare. Only a whole
//               number from 1 to 2^53-1 (the server's column is an unsigned
//               BIGINT).
//
// What can't be read is left out, never sent as "" or 0.

"use strict";

var COMPATIBLE = /^[A-Za-z0-9._-]{1,100}$/;

function text(s) { return s === null || s === undefined ? "" : String(s).replace(/\u0000/g, "").trim(); }

function keyValues(s, sep) {
    var out = {};
    text(s).split("\n").forEach(function (line) {
        var m = new RegExp("^([A-Za-z_][A-Za-z0-9_]*)\\s*" + sep + "\\s*(.*)$").exec(line.trim());
        if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").trim();
    });
    return out;
}

function compatibleOf(read) {
    var rauc = keyValues(read("/etc/rauc/system.conf"), "=").compatible;
    if (rauc && COMPATIBLE.test(rauc)) return rauc;
    var machine = keyValues(read("/etc/buildinfo"), "=").MACHINE;
    if (!machine) return "";
    var c = machine.indexOf("phoenix-") === 0 ? machine : "phoenix-" + machine;
    return COMPATIBLE.test(c) ? c : "";
}

function profileName(read) {
    var id = /(?:^|\s)phoenix\.device=(\S+)/.exec(text(read("/proc/cmdline")));
    if (!id) return "";
    try {
        var profiles = JSON.parse(read("/usr/share/phoenix/devices/device-profiles.json") || "{}").profiles || [];
        var p = profiles.filter(function (x) { return x && x.id === id[1]; })[0];
        return p && typeof p.name === "string" ? text(p.name) : "";
    } catch (e) { return ""; }
}

function dmiName(read) {
    var vendor = text(read("/sys/class/dmi/id/sys_vendor")), product = text(read("/sys/class/dmi/id/product_name"));
    if (!product) return "";
    return vendor && product.toLowerCase().indexOf(vendor.toLowerCase()) !== 0 ? vendor + " " + product : product;
}

function productVersion(read) {
    try {
        var p = JSON.parse(read("/usr/share/phoenix/product.json") || "null");
        return p && typeof p.version === "string" ? text(p.version) : "";
    } catch (e) { return ""; }
}

function deviceInfo(read) {
    var safeRead = function (p) { try { return read(p); } catch (e) { return null; } };
    var os = keyValues(safeRead("/etc/os-release"), "=");
    var out = {};
    var compatible = compatibleOf(safeRead);
    if (compatible) out.compatible = compatible;
    var model = (text(safeRead("/proc/device-tree/model")) || profileName(safeRead) || dmiName(safeRead)).slice(0, 100);
    if (model) out.model = model;
    out.name = model || "Phoenix device";
    var version = (productVersion(safeRead) || os.VERSION_ID || "").slice(0, 50);
    if (version) out.osVersion = version;
    var build = /^\d+$/.test(os.BUILD_ID || "") ? Number(os.BUILD_ID) : 0;
    if (build > 0 && Number.isSafeInteger(build)) out.build = build;
    return out;
}

module.exports = { deviceInfo: deviceInfo };
