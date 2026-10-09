// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The driver catalog (docs/DRIVERS.md): a static, signed JSON index any web
// host or mirror can serve, written by server/drivers (PHP). The same trust
// model as the Marketplace's catalogs (apps/marketplace/service/lib/catalog.js),
// with one difference: drivers install as root, so the device does not trust
// a driver catalog on first use. Its key is pinned in the system image
// (/etc/palm/hardware/catalog.json). Next to each other at the source's URL:
//
//   key.json           {"key": "<base64 Ed25519 public key>", "name": "..."}
//   drivers.json       {"format": 1, "build": 7, "generated", "expires",
//                       "source": {"id", "name"}, "drivers": [entry, ...]}
//   drivers.json.sig   base64 Ed25519 signature of drivers.json's bytes
//
// An entry:
//   {id, kind: "firmware" | "module" | "service", title, summary, category,
//    match: ["usb:v0BDApC811d*", "pci:v000010DEd00001F82sv*", "of:N*T*Cvendor,chip*", ...],
//    firmware: ["rtw88/rtw8821c_fw.bin"]   files a driver asks the kernel for
//                                          (or globs of them: "iwlwifi-*.ucode")
//    modules: ["rtw88_8821cu"]              kernel modules it provides or uses
//    optional: false                         an extra for hardware that already works
//    supersedes: ["linux-firmware-rtl8821"]  the image's package a newer version
//                                          replaces (its files go to
//                                          /lib/firmware/updates, which the
//                                          kernel reads first)
//    after: "reload" | "rebind" | "reboot" | "none"
//    license: {id (SPDX or LicenseRef-), name, text, url, free, redistributable},
//    source (where the files come from), homepage,
//    packages: [{name, version, arch, kernel?, url (relative to the catalog),
//                size, installedSize, sha256}]}
//
// match patterns are the kernel's modalias globs (modules.alias: *, ? and
// [...]), so a driver package names its devices the way its module does.
// An entry also applies to a device whose driver asked for one of its
// firmware files and did not get it (the kernel log).

"use strict";

var ed25519 = require("./ed25519");
var b64 = require("./b64");

var KINDS = ["firmware", "module", "service"];
var AFTER = ["reload", "rebind", "reboot", "none"];
var CATEGORIES = ["wifi", "bluetooth", "graphics", "camera", "audio", "input", "sensors", "storage", "modem", "network", "usb", "other"];
var BUSES = ["pci", "usb", "sdio", "of", "acpi", "i2c", "spi", "platform", "hid", "dmi", "serio", "input"];

function fail(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}
function str(v, max) { return typeof v === "string" ? v.slice(0, max || 4000) : ""; }
function strings(v, max, test) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string" && x && (!test || test(x)); }).slice(0, max) : [];
}
function url(v) { return typeof v === "string" && /^(https?|file):\/\//i.test(v) ? v : ""; }

// A modalias glob (fnmatch: *, ?, [...] and [!...]) as a RegExp, as the
// kernel's modules.alias patterns are matched (modprobe, libkmod's
// kmod_module_new_from_lookup).
function globToRegExp(glob) {
    var re = "^";
    for (var i = 0; i < glob.length; i++) {
        var c = glob[i];
        if (c === "*") re += ".*";
        else if (c === "?") re += ".";
        else if (c === "[") {
            var j = glob.indexOf("]", i + 2);
            if (j < 0) { re += "\\["; continue; }
            var set = glob.slice(i + 1, j);
            re += "[" + (set[0] === "!" ? "^" + set.slice(1) : set).replace(/\\/g, "\\\\") + "]";
            i = j;
        } else re += c.replace(/[.+^${}()|\\/]/g, "\\$&");
    }
    return new RegExp(re + "$");
}

function validPattern(p) {
    var bus = p.split(":")[0];
    return BUSES.indexOf(bus) >= 0 && p.length <= 200 && p.length > bus.length + 1;
}

// One entry as the device uses it; null when it is not usable. Entries whose
// licence does not allow redistribution are dropped: Phoenix only fetches
// what may be passed on (docs/LEGAL.md, "Firmware and drivers").
function normalize(e, baseUrl) {
    if (!e || typeof e.id !== "string" || !/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(e.id) || e.id.length > 80) return null;
    if (KINDS.indexOf(e.kind) < 0) return null;
    var lic = e.license || {};
    if (!str(lic.id, 120) || !str(lic.name, 200) || lic.redistributable !== true) return null;
    var match = strings(e.match, 200, validPattern);
    var firmware = strings(e.firmware, 200, function (f) { return !/(^|\/)\.\.(\/|$)/.test(f) && f[0] !== "/"; });
    if (!match.length && !firmware.length) return null;
    var packages = (Array.isArray(e.packages) ? e.packages : []).map(function (p) {
        if (!p || !/^[a-z0-9][a-z0-9.+-]*$/.test(p.name || "") || !str(p.version, 80) || !str(p.arch, 40)) return null;
        if (!/^[0-9a-f]{64}$/i.test(p.sha256 || "") || !(p.size > 0) || typeof p.url !== "string" || !p.url) return null;
        var abs;
        try { abs = new URL(p.url, baseUrl).href; } catch (x) { return null; }
        if (!url(abs)) return null;
        return { name: p.name, version: p.version, arch: p.arch, kernel: str(p.kernel, 80) || null, url: abs,
                 size: p.size, installedSize: p.installedSize > 0 ? p.installedSize : null, sha256: p.sha256.toLowerCase() };
    }).filter(Boolean);
    if (!packages.length) return null;
    return {
        id: e.id, kind: e.kind, title: str(e.title, 120) || e.id, summary: str(e.summary, 400), description: str(e.description, 4000),
        category: CATEGORIES.indexOf(e.category) >= 0 ? e.category : "other",
        match: match, firmware: firmware, modules: strings(e.modules, 50, function (m) { return /^[A-Za-z0-9_-]+$/.test(m); }),
        optional: !!e.optional, after: AFTER.indexOf(e.after) >= 0 ? e.after : "reload",
        supersedes: strings(e.supersedes, 20, function (n) { return /^[a-z0-9][a-z0-9.+-]*$/.test(n); }),
        license: { id: str(lic.id, 120), name: str(lic.name, 200), text: str(lic.text, 100000), url: url(lic.url),
                   free: lic.free === true, redistributable: true },
        source: url(e.source), homepage: url(e.homepage), packages: packages
    };
}

// The index's bytes, its signature (base64) and the pinned key (base64) ->
// {build, generated, expires, name, drivers}. opts: {sha512, now (Date),
// lastBuild, baseUrl}.
function verifyIndex(indexBytes, signatureB64, keyB64, opts) {
    var sig = b64.fromBase64(String(signatureB64 || "").trim());
    var key = b64.fromBase64(String(keyB64 || ""));
    if (key.length !== 32) return Promise.reject(fail("UNTRUSTED", "No key is set for the driver catalog"));
    return ed25519.verify(sig, indexBytes, key, opts.sha512).then(function (ok) {
        if (!ok) throw fail("BAD_SIGNATURE", "The driver catalog's signature does not match its key");
        var idx;
        try { idx = JSON.parse(b64.fromUtf8(indexBytes)); } catch (e) { throw fail("BAD_INDEX", "The driver catalog is not valid JSON"); }
        if (!idx || idx.format !== 1 || !Array.isArray(idx.drivers) || typeof idx.build !== "number")
            throw fail("BAD_INDEX", "Not a format 1 driver catalog");
        var now = (opts.now || new Date()).getTime();
        if (idx.expires && Date.parse(idx.expires) < now) throw fail("EXPIRED", "The driver catalog expired on " + idx.expires);
        if (typeof opts.lastBuild === "number" && idx.build < opts.lastBuild)
            throw fail("ROLLBACK", "The driver catalog is older than one already seen (build " + idx.build + " < " + opts.lastBuild + ")");
        var seen = {};
        return {
            build: idx.build, generated: idx.generated || null, expires: idx.expires || null,
            name: str(idx.source && idx.source.name, 80),
            drivers: idx.drivers.map(function (e) { return normalize(e, opts.baseUrl); }).filter(function (e) {
                if (!e || seen[e.id]) return false;
                seen[e.id] = true;
                return true;
            })
        };
    });
}

// Does an entry apply to a device ({modaliases, firmwareMissing})?
function matches(entry, device) {
    var aliases = device.modaliases || [];
    var missing = device.firmwareMissing || [];
    if (!entry._re) {
        Object.defineProperty(entry, "_re", { value: entry.match.map(globToRegExp), enumerable: false });
        Object.defineProperty(entry, "_fw", { value: entry.firmware.map(globToRegExp), enumerable: false });
    }
    if (entry._fw.some(function (re) { return missing.some(function (f) { return re.test(f); }); })) return true;
    return entry._re.some(function (re) { return aliases.some(function (a) { return re.test(a); }); });
}

// The packages of an entry for this system: one per package name, for one
// of the device's package architectures (system.archs, opkg's arch.conf
// order, least specific first: "all", "core2-64", "qemux86_64"; or
// system.arch) and, for kernel modules, its running kernel. null when
// something is missing (with why).
function packagesFor(entry, system) {
    var archs = system.archs && system.archs.length ? system.archs : ["all", system.arch];
    var rank = function (a) { return a === "all" || a === "noarch" || a === "any" ? 0 : archs.indexOf(a) + 1; };
    var fits = function (p) { return rank(p.arch) > 0 || p.arch === "all" || p.arch === "noarch" || p.arch === "any"; };
    var byName = {}, order = [];
    entry.packages.forEach(function (p) {
        if (!fits(p)) return;
        if (p.kernel && p.kernel !== system.kernel) return;
        if (!byName[p.name]) order.push(p.name);
        // The most specific architecture wins ("qemux86_64" over "core2-64" over "all").
        if (!byName[p.name] || rank(p.arch) > rank(byName[p.name].arch)) byName[p.name] = p;
    });
    var names = {};
    entry.packages.forEach(function (p) { names[p.name] = true; });
    var missing = Object.keys(names).filter(function (n) { return !byName[n]; });
    if (missing.length || !order.length) {
        var kernelOnly = entry.packages.some(function (p) { return p.kernel && fits(p); });
        return { packages: null, reason: kernelOnly ? "Not built for this system's kernel (" + system.kernel + ") yet"
                                                       : "Not available for this device's processor (" + system.arch + ")" };
    }
    return { packages: order.map(function (n) { return byName[n]; }), reason: null };
}

// opkg's version order, near enough: digits compare as numbers, the rest
// as text, chunk by chunk ("20240909-r0" < "20250311-r0", "5.6.10" > "5.6.9").
function compareVersions(a, b) {
    var x = String(a || "").match(/\d+|[^\d]+/g) || [], y = String(b || "").match(/\d+|[^\d]+/g) || [];
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
        if (x[i] === undefined) return -1;
        if (y[i] === undefined) return 1;
        var nx = /^\d/.test(x[i]), ny = /^\d/.test(y[i]);
        var c = nx && ny ? parseInt(x[i], 10) - parseInt(y[i], 10) : x[i] < y[i] ? -1 : x[i] > y[i] ? 1 : 0;
        if (c) return c < 0 ? -1 : 1;
    }
    return 0;
}

// A key's fingerprint, as shown to the user (the Marketplace's, lib/catalog.js):
// SHA-256 of the key, its first 16 bytes in hex, grouped by 2.
function fingerprint(keyB64, sha256) {
    return Promise.resolve(sha256(b64.fromBase64(keyB64))).then(function (h) {
        var hex = Array.prototype.map.call(new Uint8Array(h).subarray(0, 16), function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join("");
        return hex.match(/.{4}/g).join(" ").toUpperCase();
    });
}

// A key hand-over (server/drivers, "drivers.php handover"): the catalog's
// old key signs {format: 1, from, to, issued}, naming the key that signs
// from now on. Returns the new key (base64) when the hand-over is signed by
// currentKey, is from it, and is to a key that is not revoked.
function verifyHandover(bytes, signatureB64, currentKey, revoked, sha512) {
    var sig = b64.fromBase64(String(signatureB64 || "").trim());
    return ed25519.verify(sig, bytes, b64.fromBase64(currentKey), sha512).then(function (ok) {
        if (!ok) throw fail("BAD_SIGNATURE", "The key hand-over is not signed by the catalog's key");
        var h;
        try { h = JSON.parse(b64.fromUtf8(bytes)); } catch (e) { throw fail("BAD_INDEX", "The key hand-over is not valid JSON"); }
        if (!h || h.format !== 1 || h.from !== currentKey || typeof h.to !== "string" || b64.fromBase64(h.to).length !== 32 || h.to === currentKey)
            throw fail("BAD_INDEX", "Not a key hand-over from the catalog's key");
        if ((revoked || []).indexOf(h.to) >= 0) throw fail("UNTRUSTED", "The key hand-over names a revoked key");
        return h.to;
    });
}

module.exports = {
    compareVersions: compareVersions, fingerprint: fingerprint, verifyHandover: verifyHandover,
    verifyIndex: verifyIndex, normalize: normalize, matches: matches, packagesFor: packagesFor, globToRegExp: globToRegExp,
    KINDS: KINDS, CATEGORIES: CATEGORIES
};
