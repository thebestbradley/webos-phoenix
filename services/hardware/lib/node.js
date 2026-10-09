// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.hardware on a device (service.js): sysfs through Node's
// fs (lib/sysfs.js), the kernel's log for the firmware it could not load,
// opkg for the packages, modprobe and the driver core's bind/unbind files
// to start a new driver or firmware, HTTP. Tested in
// ../hardwareservice.test.ts (opkg and modprobe as stand-in programs) and
// sysfs.test.ts (a made-up /sys).

"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var http = require("http");
var https = require("https");
var os = require("os");

// sysfs and /lib/firmware under root ("/" on a device; a folder in tests).
function createFs(root) {
    root = (root || "/").replace(/\/+$/, "");
    return {
        read: function (p) { try { return fs.readFileSync(root + p, "utf8"); } catch (e) { return null; } },
        list: function (p) { try { return fs.readdirSync(root + p).sort(); } catch (e) { return []; } },
        link: function (p) { try { return fs.readlinkSync(root + p); } catch (e) { return null; } },
        exists: function (p) { try { fs.statSync(root + p); return true; } catch (e) { return false; } }
    };
}

function run(command, args, opts) {
    return new Promise(function (resolve) {
        childProcess.execFile(command, args, Object.assign({ maxBuffer: 8 * 1024 * 1024, timeout: 600000 }, opts || {}), function (e, stdout, stderr) {
            resolve({ ok: !e, stdout: String(stdout || ""), error: e ? (String(stderr || "").trim().split("\n").pop() || e.message) : null });
        });
    });
}

// opkg (OSE images keep its database: IMAGE_FEATURES package-management,
// meta-phoenix's webos-phoenix-image). options: {command ("opkg")}.
function createOpkg(options) {
    var command = (options && options.command) || "opkg";
    return {
        list: function () {
            return run(command, ["list-installed"]).then(function (r) {
                return r.stdout.split("\n").map(function (line) {
                    var m = /^(\S+) - (\S+)/.exec(line);
                    return m ? { name: m[1], version: m[2] } : null;
                }).filter(Boolean);
            });
        },
        // Files already checked against the signed catalog; opkg installs
        // their dependencies from the configured feeds.
        install: function (paths, o) {
            return run(command, ["install"].concat(o && o.downgrade ? ["--force-downgrade"] : [], paths));
        },
        remove: function (names) { return run(command, ["remove"].concat(names)); }
    };
}

// Starting what was installed: "reload" unloads and loads the modules again
// (a driver asks for its firmware when it probes); "rebind" unbinds and binds
// the device to its driver; "none" and "reboot" do nothing now. After
// either, udev is asked to look at the devices again, so a driver that
// binds by modalias finds its device. options: {modprobe, udevadm, root}.
function createActivator(options) {
    options = options || {};
    var modprobe = options.modprobe || "modprobe", udevadm = options.udevadm || "udevadm";
    var root = (options.root || "").replace(/\/+$/, "");
    return function activate(step) {
        var mods = (step.modules || []).filter(function (m) { return /^[A-Za-z0-9_-]+$/.test(m); });
        var chain = Promise.resolve();
        if (step.after === "reload" && mods.length) {
            chain = run(modprobe, ["-r"].concat(mods.slice().reverse())).then(function () {
                return mods.reduce(function (c, m) { return c.then(function () { return run(modprobe, [m]); }); }, Promise.resolve());
            });
        } else if (step.after === "rebind" && step.deviceId) {
            var m = /^(pci|usb|sdio|platform|i2c|spi):(.+)$/.exec(step.deviceId);
            if (m && /^[A-Za-z0-9:._-]+$/.test(m[2])) {
                var dev = root + "/sys/bus/" + m[1] + "/devices/" + m[2];
                chain = new Promise(function (resolve) {
                    var drv = null;
                    try { drv = fs.realpathSync(dev + "/driver"); } catch (e) { /* none bound */ }
                    try { if (drv) fs.writeFileSync(drv + "/unbind", m[2]); } catch (e) { /* not bound */ }
                    try { fs.writeFileSync(root + "/sys/bus/" + m[1] + "/drivers_probe", m[2]); } catch (e) { /* probed by udev */ }
                    resolve();
                });
            }
        }
        if (step.after === "reboot" || step.after === "none") return chain;
        return chain.then(function () {
            return run(udevadm, ["trigger", "--action=add"]).then(function () { return run(udevadm, ["settle", "--timeout=10"]); });
        }).then(function () {});
    };
}

// The kernel's messages, for "Direct firmware load ... failed".
function kernelLog() {
    return run("dmesg", []).then(function (r) {
        if (r.ok) return r.stdout;
        return run("journalctl", ["-k", "-b", "--no-pager", "-o", "cat"]).then(function (j) { return j.stdout; });
    });
}

// Vendor and device names from hwdata's pci.ids and usb.ids, when the
// image has them (the device's own strings come first for USB).
function createNames(files) {
    var tables = {};
    function table(bus) {
        if (tables[bus] !== undefined) return tables[bus];
        var text = null;
        (files[bus] || []).some(function (f) { try { text = fs.readFileSync(f, "utf8"); return true; } catch (e) { return false; } });
        var t = null;
        if (text) {
            t = {};
            var vendor = null;
            text.split("\n").forEach(function (line) {
                if (/^C /.test(line)) { vendor = null; return; }
                var v = /^([0-9a-f]{4})\s+(.+)$/.exec(line);
                if (v) { vendor = v[1]; t[vendor] = { name: v[2], devices: {} }; return; }
                var d = /^\t([0-9a-f]{4})\s+(.+)$/.exec(line);
                if (d && vendor) t[vendor].devices[d[1]] = d[2];
            });
        }
        tables[bus] = t;
        return t;
    }
    return function (bus, vendor, device) {
        var t = table(bus);
        var v = t && t[vendor];
        return v ? { vendor: v.name, device: v.devices[device] || null } : null;
    };
}

function arch() {
    var a = os.arch();
    return { x64: "x86_64", arm64: "aarch64", arm: "armv7", ia32: "i686" }[a] || a;
}

// The package architectures opkg installs here, least specific first
// (/etc/opkg/arch.conf: "arch all 1", "arch core2-64 16", "arch qemux86_64 21").
function opkgArchs(file) {
    var out = [];
    try {
        fs.readFileSync(file || "/etc/opkg/arch.conf", "utf8").split("\n").forEach(function (line) {
            var m = /^arch\s+(\S+)\s+(\d+)/.exec(line.trim());
            if (m) out.push({ arch: m[1], prio: parseInt(m[2], 10) });
        });
    } catch (e) { /* no opkg configuration */ }
    out.sort(function (x, y) { return x.prio - y.prio; });
    return out.map(function (x) { return x.arch; });
}

function send(req, binary, redirects) {
    return new Promise(function (resolve, reject) {
        var url = new URL(req.url);
        if (url.protocol === "file:") {
            // A catalog on the device itself (a USB drive, the installer's copy).
            try {
                var data = fs.readFileSync(decodeURIComponent(url.pathname));
                return resolve(binary ? { status: 200, headers: {}, bytes: new Uint8Array(data) } : { status: 200, headers: {}, body: data.toString("utf8") });
            } catch (e) { return resolve({ status: 404, headers: {}, body: "", bytes: new Uint8Array(0) }); }
        }
        var mod = url.protocol === "https:" ? https : http;
        var body = req.body === undefined || req.body === null ? null : Buffer.from(String(req.body), "utf8");
        var headers = Object.assign({ "User-Agent": "webOS-Phoenix-Hardware/0.1" }, req.headers || {});
        if (body) headers["Content-Length"] = String(body.length);
        var r = mod.request(url, { method: req.method || "GET", headers: headers }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5 && (req.method || "GET") === "GET") {
                res.resume();
                return resolve(send({ method: "GET", url: new URL(res.headers.location, url).href, headers: req.headers }, binary, redirects + 1));
            }
            var chunks = [];
            res.on("data", function (c) { chunks.push(c); });
            res.on("end", function () {
                var buf = Buffer.concat(chunks);
                resolve(binary ? { status: res.statusCode, headers: {}, bytes: new Uint8Array(buf) } : { status: res.statusCode, headers: {}, body: buf.toString("utf8") });
            });
            res.on("error", reject);
        });
        r.setTimeout(300000, function () { r.destroy(new Error("request timed out: " + req.url)); });
        r.on("error", reject);
        if (body) r.write(body);
        r.end();
    });
}

module.exports = {
    createFs: createFs, createOpkg: createOpkg, createActivator: createActivator, createNames: createNames,
    kernelLog: kernelLog, arch: arch, opkgArchs: opkgArchs, run: run,
    request: function (req) { return send(req, false, 0); },
    requestBytes: function (req) { return send(req, true, 0); }
};
