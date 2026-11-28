// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.update on a device (service.js): RAUC's command line, the
// running system's version (the product file, /etc/os-release), HTTP, streamed downloads with
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

// The product the image was built as (product.json at the top of the checkout,
// installed at /usr/share/phoenix/product.json: tools/install-rootfs.py):
// {name, version}, or {} without it.
function productFile(file) {
    try {
        var p = JSON.parse(fs.readFileSync(file || "/usr/share/phoenix/product.json", "utf8"));
        return p && typeof p === "object" ? p : {};
    } catch (e) { return {}; }
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
// running system's build, "/etc/os-release"), product (its name and
// version, "/usr/share/phoenix/product.json"; os-release's NAME and
// VERSION_ID without one: OSE's own on an image, so the product's is the
// one Phoenix reports)}.
function createRauc(options) {
    var command = (options && options.command) || "rauc";
    var osReleaseFile = options && options.osRelease;
    var productPath = options && options.product;
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
                var os = osRelease(osReleaseFile), product = productFile(productPath);
                return {
                    compatible: st.compatible, name: product.name || os.NAME || "webOS Phoenix", primary: primary, other: other,
                    booted: { slot: booted, version: product.version || os.VERSION_ID || "", build: parseInt(os.BUILD_ID, 10) || 0 }
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
// the server meanwhile is caught there.
//
// With opts.resume, a response cut off before its end, a connection that
// stalls for a minute or fails, and a server error (5xx) are taken up again
// by themselves, from where they stopped, after a pause (opts.retryDelay, 5 s, doubling to a
// minute): a bundle is a few GB, and a server or a network may end a long
// response (staging cut every response at about 1 GiB, 28 November 2026,
// so a 2.3 GB update needed three). It gives up after opts.retries tries in
// a row that brought nothing (5), rejecting and keeping what came for the
// next download.
//
// What a file already holds is hashed before the request (and again only if
// a try left the file other than what it hashed), read in chunks so the
// service keeps answering: hashed in the response's callback, a
// 2 GB partial held the event loop for over a minute in the VM, the idle
// socket timed out behind it and every resume was cut off.
function download(url, file, onProgress, opts) {
    opts = opts || {};
    var retries = opts.retries === undefined ? 5 : opts.retries;
    var delay = opts.retryDelay === undefined ? 5000 : opts.retryDelay;
    var req = null, out = null, cancelled = false, pause = null, stop = null;

    function cancelledError() { return Object.assign(new Error("Cancelled"), { code: "CANCELLED" }); }
    function again(e) { return Object.assign(e, { retry: true }); }
    // A network error in words, without the system's code, which the
    // service would otherwise report as its own (DOWNLOAD_FAILED it is).
    function networkError(e) {
        var code = e && e.code;
        return again(new Error(code === "ECONNRESET" || code === "EPIPE" ? "the connection was cut off"
            : code === "ETIMEDOUT" ? "the connection timed out"
            : /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN)$/.test(code || "") ? "the server could not be reached"
            : (e && e.message) || "the connection failed"));
    }
    function sizeOf() {
        try { return fs.statSync(file).size; } catch (e) { return 0; }
    }
    // The SHA-256 of the file's first n bytes, read without blocking.
    function hashOf(n) {
        return new Promise(function (resolve, reject) {
            var h = crypto.createHash("sha256");
            if (n <= 0) return resolve(h);
            var s = fs.createReadStream(file, { start: 0, end: n - 1, highWaterMark: 1 << 20 });
            s.on("data", function (c) { h.update(c); });
            s.on("error", reject);
            s.on("end", function () { resolve(h); });
        });
    }
    // The file closed, with everything written that came.
    function closeOut() {
        var o = out;
        out = null;
        if (!o) return Promise.resolve();
        if (!o.stream.writableEnded) o.stream.end();
        return o.closed;
    }

    // One request, continuing from have bytes (whose hash is hash): resolves
    // {size, sha256} with the whole file, or rejects; err.retry for a cut,
    // with err.size and err.hash for what came (the file once closed).
    function attempt(have, hash) {
        return new Promise(function (resolve, reject) {
            var size = have, settled = false;
            function fail(e) {
                if (settled) return;
                settled = true;
                e.size = size;
                e.hash = hash;
                reject(e);
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
                        settled = true;
                        return resolve({ size: have, sha256: hash.digest("hex") });
                    }
                    if (res.statusCode !== 200 && res.statusCode !== 206) {
                        res.resume();
                        var e = new Error("the server answered " + res.statusCode);
                        return fail(res.statusCode >= 500 ? again(e) : e);
                    }
                    if (!(res.statusCode === 206 && have > 0)) {
                        // From the start: a server that ignored the range.
                        have = size = 0;
                        hash = crypto.createHash("sha256");
                    }
                    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 448 });
                    var o = fs.createWriteStream(file, { mode: 384, flags: have > 0 ? "a" : "w" });
                    out = { stream: o, closed: new Promise(function (r) { o.on("close", r); o.on("error", r); }) };
                    res.on("data", function (c) { hash.update(c); size += c.length; onProgress(size); });
                    res.on("error", function () { fail(again(new Error("the connection was cut off"))); });
                    res.on("aborted", function () { fail(again(new Error("the connection was cut off"))); });
                    res.pipe(o);
                    o.on("finish", function () {
                        if (settled) return;
                        if (!res.complete) return fail(cancelled ? cancelledError() : again(new Error("the connection was cut off")));
                        settled = true;
                        resolve({ size: size, sha256: hash.digest("hex") });
                    });
                    o.on("error", fail);
                });
                req.setTimeout(60000, function () { req.destroy(again(new Error("the connection timed out"))); });
                req.on("error", function (e) {
                    if (cancelled) return fail(cancelledError());
                    // No answer, or the network went: worth another try.
                    fail(e && e.retry ? e : networkError(e));
                });
            }
            get(url, 0);
        });
    }

    var promise = new Promise(function (resolve, reject) {
        var idle = 0, wait = delay;
        stop = function () { reject(cancelledError()); };
        function next(hash) {
            if (cancelled) return reject(cancelledError());
            var have = opts.resume ? sizeOf() : 0;
            (hash ? Promise.resolve(hash) : hashOf(have)).then(function (h) {
                if (cancelled) throw cancelledError();
                return attempt(have, h);
            }).then(function (got) {
                return closeOut().then(function () { resolve(got); });
            }, function (e) {
                return closeOut().then(function () {
                    if (cancelled || (e && e.code === "CANCELLED")) return reject(cancelledError());
                    if (!(e && e.retry) || !opts.resume) return reject(e);
                    // A try that brought something starts the count again.
                    if (sizeOf() > have) { idle = 0; wait = delay; } else idle++;
                    if (idle >= retries) return reject(e);
                    var kept = sizeOf() === e.size ? e.hash : null;
                    pause = setTimeout(function () { pause = null; next(kept); }, wait);
                    wait = Math.min(wait * 2, 60000);
                });
            }).then(null, reject);
        }
        next(null);
    });
    return {
        promise: promise,
        cancel: function () {
            cancelled = true;
            if (pause) { clearTimeout(pause); pause = null; stop(); }
            if (req) req.destroy();
        }
    };
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

// Dev push's developer overlays (docs/DEV-PUSH.md 4.6) are kept per build
// under /var/lib/phoenix/overlay/<BUILD_ID>, with the overlay's state.json
// (its "build") beside them. Once the running build is good, the others go:
// they can never be mounted on this build, and a fall back to the other slot
// is only possible before mark-good. -> the names removed
function clearOtherOverlays(opts) {
    opts = opts || {};
    var dir = opts.dir || "/var/lib/phoenix/overlay";
    var build = opts.build !== undefined ? opts.build : osRelease(opts.osRelease).BUILD_ID;
    var gone = [];
    if (!build) return gone;
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return gone; }
    names.forEach(function (n) {
        var full = path.join(dir, n);
        var st;
        try { st = fs.lstatSync(full); } catch (e) { return; }
        if (n === "state.json") {
            var s = null;
            try { s = JSON.parse(fs.readFileSync(full, "utf8")); } catch (e) { s = null; }
            if (s && s.build && s.build !== build) { fs.rmSync(full, { force: true }); gone.push(n); }
        } else if (st.isDirectory() && n !== build) {
            fs.rmSync(full, { recursive: true, force: true });
            gone.push(n);
        }
    });
    return gone;
}

module.exports = { osRelease: osRelease, clearOtherOverlays: clearOtherOverlays, createRauc: createRauc, download: download, power: power, request: request,
                   requestBytes: requestBytes };
