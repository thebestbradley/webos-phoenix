// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// .ipk packages: an ar archive (like a .deb) of
//
//   debian-binary     "2.0\n"
//   control.tar.gz    ./control (Package, Version, Architecture, ...), and
//                     maintainer scripts (postinst, prerm, ...) if any
//   data.tar.gz       the files, at their device paths:
//                     ./usr/palm/applications/<id>/appinfo.json, ...
//
// as opkg-build, palm-package and ares-package write them. read() unpacks
// one; write() makes one (the Marketplace packages a web app this way).
// gzip is passed in: {gunzip(bytes), gzip(bytes)} -> Promise<Uint8Array>
// (Node's zlib on a device, DecompressionStream in the simulator).

"use strict";

function fail(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}

function ascii(bytes, start, end) {
    var s = "";
    for (var i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
    return s;
}
function utf8(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    return new Uint8Array(Buffer.from(text, "utf8"));
}
function fromUtf8(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString("utf8");
}

// ---- ar --------------------------------------------------------------------------

function readAr(bytes) {
    if (ascii(bytes, 0, 8) !== "!<arch>\n") throw fail("NOT_AN_IPK", "Not an .ipk package (no ar header)");
    var out = {}, pos = 8;
    while (pos + 60 <= bytes.length) {
        var name = ascii(bytes, pos, pos + 16).trim().replace(/\/$/, "");
        var size = parseInt(ascii(bytes, pos + 48, pos + 58).trim(), 10);
        if (ascii(bytes, pos + 58, pos + 60) !== "`\n" || !(size >= 0)) throw fail("NOT_AN_IPK", "Damaged .ipk package (ar)");
        out[name] = bytes.subarray(pos + 60, pos + 60 + size);
        pos += 60 + size + (size % 2);
    }
    return out;
}

function arHeader(name, size) {
    function field(v, n) { v = String(v); while (v.length < n) v += " "; return v.slice(0, n); }
    return utf8(field(name, 16) + field(0, 12) + field(0, 6) + field(0, 6) + field("100644", 8) + field(size, 10) + "`\n");
}
function writeAr(entries) {
    var parts = [utf8("!<arch>\n")];
    entries.forEach(function (e) {
        parts.push(arHeader(e.name, e.data.length), e.data);
        if (e.data.length % 2) parts.push(new Uint8Array([10]));
    });
    return concat(parts);
}

function concat(parts) {
    var n = 0;
    parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n), o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
}

// ---- tar (ustar, with GNU long names and pax paths) ---------------------------------

function readTar(bytes) {
    var files = [], pos = 0, longName = null;
    while (pos + 512 <= bytes.length) {
        var h = bytes.subarray(pos, pos + 512);
        if (h.every(function (b) { return b === 0; })) break;
        var name = ascii(h, 0, 100).replace(/\0.*$/, "");
        var size = parseInt(ascii(h, 124, 136).replace(/\0.*$/, "").trim() || "0", 8);
        var type = String.fromCharCode(h[156] || 48);
        var prefix = ascii(h, 345, 500).replace(/\0.*$/, "");
        var mode = parseInt(ascii(h, 100, 108).replace(/\0.*$/, "").trim() || "0", 8);
        var body = bytes.subarray(pos + 512, pos + 512 + size);
        pos += 512 + Math.ceil(size / 512) * 512;
        if (type === "L") { longName = fromUtf8(body).replace(/\0.*$/, ""); continue; }
        if (type === "x") {
            var m = /\d+ path=([^\n]*)\n/.exec(fromUtf8(body));
            if (m) longName = m[1];
            continue;
        }
        if (type === "g") continue;
        var path = longName || (prefix ? prefix + "/" + name : name);
        longName = null;
        path = path.replace(/^\.\//, "").replace(/^\/+/, "");
        if (type === "0" || type === "\0" || type === "7") files.push({ path: path, mode: mode, data: body });
        else if (type === "5") files.push({ path: path.replace(/\/$/, ""), mode: mode, dir: true });
        else if (type === "2" || type === "1") files.push({ path: path, link: ascii(h, 157, 257).replace(/\0.*$/, "") });
    }
    return files;
}

function tarHeader(path, size, type, mode) {
    var h = new Uint8Array(512);
    function put(off, len, text) { var b = utf8(text); h.set(b.subarray(0, len), off); }
    function octal(off, len, n) { var s = n.toString(8); while (s.length < len - 1) s = "0" + s; put(off, len, s + "\0"); }
    var name = path, prefix = "";
    if (utf8(name).length > 100) {
        var cut = path.lastIndexOf("/", 154);
        prefix = path.slice(0, cut);
        name = path.slice(cut + 1);
        if (cut < 0 || utf8(name).length > 100) throw fail("BAD_PARAMS", "Path too long for the package: " + path);
    }
    put(0, 100, name);
    octal(100, 8, mode);
    octal(108, 8, 0);
    octal(116, 8, 0);
    octal(124, 12, size);
    octal(136, 12, 0);
    for (var i = 148; i < 156; i++) h[i] = 32;
    h[156] = type.charCodeAt(0);
    put(257, 6, "ustar\0");
    put(263, 2, "00");
    put(345, 155, prefix);
    var sum = 0;
    for (var j = 0; j < 512; j++) sum += h[j];
    octal(148, 7, sum);
    h[155] = 32;
    return h;
}
function writeTar(files) {
    var parts = [], dirs = {};
    files.forEach(function (f) {
        // Each folder once, before its files, as tar -c writes them.
        var segs = f.path.split("/");
        for (var i = 1; i < segs.length; i++) {
            var d = "./" + segs.slice(0, i).join("/") + "/";
            if (dirs[d]) continue;
            dirs[d] = true;
            parts.push(tarHeader(d, 0, "5", 493));
        }
        parts.push(tarHeader("./" + f.path, f.data.length, "0", f.mode || 420), f.data);
        if (f.data.length % 512) parts.push(new Uint8Array(512 - f.data.length % 512));
    });
    parts.push(new Uint8Array(1024));
    return concat(parts);
}

// ---- control ---------------------------------------------------------------------------

// "Key: value" lines (continuations start with a space) -> {Key: value}.
function parseControl(text) {
    var out = {}, key = null;
    String(text).split(/\r?\n/).forEach(function (line) {
        if (/^\s/.test(line) && key) { out[key] += "\n" + line.trim(); return; }
        var m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
        if (m) { key = m[1]; out[key] = m[2]; }
    });
    return out;
}

// ---- The package -------------------------------------------------------------------------

var APP_ROOT = "usr/palm/applications/";
var SCRIPTS = ["preinst", "postinst", "prerm", "postrm", "pmPostInstall.script", "pmPreRemove.script"];

function createIpk(opts) {
    var gz = opts.gzip;

    // bytes -> {control, scripts: [names], files: [{path, mode, data}], apps:
    // [{id, dir, appinfo}], services: [paths]}.
    function read(bytes) {
        var ar;
        try { ar = readAr(bytes); } catch (e) { return Promise.reject(e); }
        var controlTar = ar["control.tar.gz"], dataTar = ar["data.tar.gz"];
        if (!controlTar || !dataTar) return Promise.reject(fail("NOT_AN_IPK", "Not an .ipk package (no control or data)"));
        return Promise.all([gz.gunzip(controlTar), gz.gunzip(dataTar)]).then(function (r) {
            var control = readTar(r[0]), data = readTar(r[1]);
            var controlFile = control.filter(function (f) { return f.path === "control"; })[0];
            if (!controlFile) throw fail("NOT_AN_IPK", "The package has no control file");
            var apps = [];
            data.forEach(function (f) {
                var m = /^usr\/palm\/applications\/([^/]+)\/appinfo\.json$/.exec(f.path);
                if (!m || !f.data) return;
                var info;
                try { info = JSON.parse(fromUtf8(f.data).replace(/^﻿/, "")); } catch (e) { throw fail("BAD_APPINFO", "appinfo.json of " + m[1] + " is not valid JSON"); }
                apps.push({ id: info.id || m[1], dir: APP_ROOT + m[1] + "/", appinfo: info });
            });
            return {
                control: parseControl(fromUtf8(controlFile.data)),
                scripts: control.filter(function (f) { return SCRIPTS.indexOf(f.path) >= 0; }).map(function (f) { return f.path; }),
                files: data.filter(function (f) { return f.data; }),
                links: data.filter(function (f) { return f.link; }).map(function (f) { return f.path; }),
                apps: apps,
                services: data.filter(function (f) { return /^usr\/palm\/services\//.test(f.path); }).map(function (f) { return f.path; })
            };
        }, function () { throw fail("NOT_AN_IPK", "Damaged .ipk package (gzip)"); });
    }

    // {control: {Package, Version, ...}, files: [{path (device path without
    // the leading /), data: Uint8Array | string}]} -> the .ipk's bytes.
    function write(pkg) {
        var c = pkg.control, lines = [];
        ["Package", "Version", "Section", "Priority", "Architecture", "Maintainer", "Installed-Size", "Description", "Source"].forEach(function (k) {
            if (c[k] !== undefined && c[k] !== "") lines.push(k + ": " + String(c[k]).replace(/\n/g, "\n "));
        });
        var files = pkg.files.map(function (f) {
            return { path: f.path.replace(/^\/+/, ""), data: typeof f.data === "string" ? utf8(f.data) : f.data, mode: f.mode };
        });
        return Promise.all([
            gz.gzip(writeTar([{ path: "control", data: utf8(lines.join("\n") + "\n") }])),
            gz.gzip(writeTar(files))
        ]).then(function (r) {
            return writeAr([{ name: "debian-binary", data: utf8("2.0\n") }, { name: "control.tar.gz", data: r[0] },
                            { name: "data.tar.gz", data: r[1] }]);
        });
    }

    return { read: read, write: write };
}

module.exports = { createIpk: createIpk, parseControl: parseControl, readTar: readTar, writeTar: writeTar, readAr: readAr, APP_ROOT: APP_ROOT };
