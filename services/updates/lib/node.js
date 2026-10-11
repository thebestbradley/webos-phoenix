// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.update on a device (service.js): RAUC's command line, the
// running system's version (/etc/os-release), HTTP, streamed downloads with
// their SHA-256, and the battery. Tested in ../updatesservice.test.ts.

"use strict";

var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");

function osRelease(file) {
    var out = {};
    try {
        fs.readFileSync(file || "/etc/os-release", "utf8").split("\n").forEach(function (line) {
            var m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
            if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
        });
    } catch (e) { /* no os-release */ }
    return out;
}

function raucCli(command, args) {
    return new Promise(function (resolve, reject) {
        childProcess.execFile(command, args, { maxBuffer: 4 * 1024 * 1024 }, function (e, stdout, stderr) {
            if (e) return reject(new Error((String(stderr).trim().split("\n").pop()) || e.message));
            resolve(stdout);
        });
    });
}

// RAUC through its command line (the RAUC daemon underneath), as
// updatesservice.js wants it. options: {command ("rauc"), osRelease (the
// running system's version, "/etc/os-release")}.
function createRauc(options) {
    var command = (options && options.command) || "rauc";
    var osReleaseFile = options && options.osRelease;
    var raucApi = {
        status: function () {
            return raucCli(command, ["status", "--output-format=json"]).then(function (out) {
                var st = JSON.parse(out);
                var booted = null, other = null, primary = st.boot_primary || null;
                (st.slots || []).forEach(function (entry) {
                    Object.keys(entry).forEach(function (name) {
                        if (entry[name].class !== "rootfs") return;
                        if (entry[name].state === "booted") booted = name;
                        else other = name;
                    });
                });
                var os = osRelease(osReleaseFile);
                return {
                    compatible: st.compatible, name: os.NAME || "webOS Phoenix", primary: primary, other: other,
                    booted: { slot: booted, version: os.VERSION_ID || "", build: parseInt(os.BUILD_ID, 10) || 0 }
                };
            });
        },
        info: function (file) {
            return raucCli(command, ["info", "--output-format=json", file]).then(function (out) {
                var m = JSON.parse(out);
                return { compatible: m.compatible, version: m.version, build: parseInt(m.build, 10) || 0 };
            });
        },
        markActive: function (slot) {
            return raucCli(command, ["status", "mark-active", slot]);
        },
        // The running slot started well: what meta-rauc's
        // rauc-mark-good.service runs at boot (`rauc status mark-good`),
        // which resets the bootloader's attempts for it.
        markGood: function () {
            return raucCli(command, ["status", "mark-good"]);
        },
        install: function (file, onProgress) {
            return new Promise(function (resolve, reject) {
                var p = childProcess.spawn(command, ["install", file]);
                var tail = "";
                function lines(chunk) {
                    String(chunk).split("\n").forEach(function (line) {
                        var m = /^\s*(\d+)%\s*(.*)$/.exec(line);
                        if (m) onProgress(parseInt(m[1], 10), m[2]);
                        else if (line.trim()) tail = line.trim();
                    });
                }
                p.stdout.on("data", lines);
                p.stderr.on("data", lines);
                p.on("error", reject);
                p.on("close", function (code) { code === 0 ? resolve() : reject(new Error(tail || "rauc install failed (" + code + ")")); });
            });
        }
    };
    return raucApi;
}

// Streams to the file, hashing as it goes; follows redirects. With
// opts.resume and a file left by a download that stopped, asks for the
// rest (Range: bytes=<size>-, RFC 9110 14.2): 206 appends to it, 200 (a
// server without ranges) starts again, 416 means it was all there. The
// caller checks size and SHA-256 of the whole, so a file that changed on
// the server meanwhile is caught there. A response cut off before its end
// rejects and keeps what came.
function download(url, file, onProgress, opts) {
    var req = null, cancelled = false;
    var promise = new Promise(function (resolve, reject) {
        var have = 0;
        if (opts && opts.resume) {
            try { have = fs.statSync(file).size; } catch (e) { have = 0; }
        }
        function hashOf(n) {
            var h = crypto.createHash("sha256");
            if (n > 0) {
                var fd = fs.openSync(file, "r"), buf = Buffer.alloc(1 << 20), pos = 0;
                try {
                    while (pos < n) {
                        var got = fs.readSync(fd, buf, 0, Math.min(buf.length, n - pos), pos);
                        if (got <= 0) break;
                        h.update(buf.subarray(0, got));
                        pos += got;
                    }
                } finally { fs.closeSync(fd); }
            }
            return h;
        }
        function get(u, redirects) {
            var mod = new URL(u).protocol === "https:" ? https : http;
            var headers = { "User-Agent": "webOS-Phoenix-Updates/0.1" };
            if (have > 0) headers.Range = "bytes=" + have + "-";
            req = mod.get(u, { headers: headers }, function (res) {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
                    res.resume();
                    return get(new URL(res.headers.location, u).href, redirects + 1);
                }
                if (res.statusCode === 416 && have > 0) {
                    res.resume();
                    return resolve({ size: have, sha256: hashOf(have).digest("hex") });
                }
                if (res.statusCode !== 200 && res.statusCode !== 206) {
                    res.resume();
                    return reject(new Error("the server answered " + res.statusCode));
                }
                var append = res.statusCode === 206 && have > 0;
                fs.mkdirSync(path.dirname(file), { recursive: true, mode: 448 });
                var hash = append ? hashOf(have) : crypto.createHash("sha256"), size = append ? have : 0;
                var out = fs.createWriteStream(file, { mode: 384, flags: append ? "a" : "w" });
                res.on("data", function (c) { hash.update(c); size += c.length; onProgress(size); });
                res.on("error", reject);
                res.on("aborted", function () { reject(new Error("the connection was cut off")); });
                res.pipe(out);
                out.on("finish", function () {
                    if (!res.complete) return reject(cancelled ? Object.assign(new Error("Cancelled"), { code: "CANCELLED" })
                                                               : new Error("the connection was cut off"));
                    resolve({ size: size, sha256: hash.digest("hex") });
                });
                out.on("error", reject);
            });
            req.setTimeout(60000, function () { req.destroy(new Error("the connection timed out")); });
            req.on("error", function (e) {
                reject(cancelled ? Object.assign(new Error("Cancelled"), { code: "CANCELLED" }) : e);
            });
        }
        get(url, 0);
    });
    return { promise: promise, cancel: function () { cancelled = true; if (req) req.destroy(); } };
}

// The battery and whether a charger is connected (/sys/class/power_supply);
// null without a battery.
function power(dir) {
    var names;
    try { names = fs.readdirSync(dir || "/sys/class/power_supply"); } catch (e) { return Promise.resolve(null); }
    var battery = null, charging = false;
    names.forEach(function (n) {
        var read = function (f) { try { return fs.readFileSync(path.join(dir || "/sys/class/power_supply", n, f), "utf8").trim(); } catch (e) { return ""; } };
        var type = read("type");
        if (type === "Battery" && battery === null) {
            battery = parseInt(read("capacity"), 10);
            if (/^(Charging|Full)$/.test(read("status"))) charging = true;
        } else if (type !== "Battery" && read("online") === "1") {
            charging = true;
        }
    });
    return Promise.resolve(battery === null || isNaN(battery) ? null : { percent: battery, charging: charging });
}

function request(req) {
    return new Promise(function (resolve, reject) {
        var mod = new URL(req.url).protocol === "https:" ? https : http;
        var r = mod.get(req.url, { headers: { "User-Agent": "webOS-Phoenix-Updates/0.1" } }, function (res) {
            var chunks = [];
            res.on("data", function (c) { chunks.push(c); });
            res.on("end", function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }); });
            res.on("error", reject);
        });
        r.setTimeout(60000, function () { r.destroy(new Error("the connection timed out")); });
        r.on("error", reject);
    });
}

// The same as bytes (a signed feed is checked over its exact bytes).
function requestBytes(req) {
    return new Promise(function (resolve, reject) {
        var mod = new URL(req.url).protocol === "https:" ? https : http;
        var r = mod.get(req.url, { headers: { "User-Agent": "webOS-Phoenix-Updates/0.1" } }, function (res) {
            var chunks = [], size = 0;
            res.on("data", function (c) {
                size += c.length;
                if (size > 4 * 1024 * 1024) return r.destroy(new Error("the reply is too large"));
                chunks.push(c);
            });
            res.on("end", function () { resolve({ status: res.statusCode, bytes: new Uint8Array(Buffer.concat(chunks)) }); });
            res.on("error", reject);
        });
        r.setTimeout(60000, function () { r.destroy(new Error("the connection timed out")); });
        r.on("error", reject);
    });
}

module.exports = { osRelease: osRelease, createRauc: createRauc, download: download, power: power, request: request,
                   requestBytes: requestBytes };
