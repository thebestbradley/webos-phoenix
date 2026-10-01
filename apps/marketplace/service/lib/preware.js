// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Preware feeds (WebOS Internals' package manager): an ipkg "Packages" file
// at the feed's URL, one paragraph per package (Package, Version,
// Architecture, Filename, MD5Sum, Size, Description, Maintainer), with a
// JSON "Source" field Preware added (Title, Icon, Homepage, License,
// FullDescription, Category, Type, Screenshots, MinWebOSVersion,
// DeviceCompatibility). parse(text, feedUrl, sourceId) -> catalog entries of
// kind "preware". Only packages for any architecture ("all") can run here:
// the others are 2011 ARM binaries.

"use strict";

var ipk = require("./ipk");
var version = require("./version");

function parse(text, feedUrl, sourceId) {
    var base = String(feedUrl).replace(/\/*$/, "/");
    var out = [], seen = {};
    String(text).split(/\r?\n\r?\n/).forEach(function (para) {
        var c = ipk.parseControl(para);
        if (!c.Package || !c.Filename) return;
        var src = {};
        try { src = c.Source ? JSON.parse(c.Source) : {}; } catch (e) { src = {}; }
        var entry = {
            id: c.Package, sourceId: sourceId, kind: "preware",
            title: String(src.Title || c.Description || c.Package).slice(0, 80),
            developer: { name: String(c.Maintainer || "").replace(/\s*<[^>]*>\s*/, "").slice(0, 80), url: "" },
            summary: String(c.Description || "").slice(0, 300),
            description: String(src.FullDescription || "").replace(/\\n/g, "\n").slice(0, 8000),
            categories: src.Category ? [String(src.Category)] : c.Section ? [c.Section] : [],
            icon: typeof src.Icon === "string" && /^https?:/.test(src.Icon) ? src.Icon : "",
            screenshots: Array.isArray(src.Screenshots) ? src.Screenshots.filter(function (s) { return /^https?:/.test(s); }).slice(0, 8) : [],
            license: String(src.License || ""), homepage: typeof src.Homepage === "string" && /^https?:/.test(src.Homepage) ? src.Homepage : "",
            donation: "", featured: false, rating: null, version: c.Version || "",
            architecture: c.Architecture || "", type: String(src.Type || ""),
            release: { url: base + c.Filename, size: parseInt(c.Size, 10) || 0, md5: String(c.MD5Sum || "").toLowerCase() }
        };
        // The newest version of each package.
        if (seen[entry.id] !== undefined) {
            var prev = out[seen[entry.id]];
            if (version.compare(prev.version, entry.version) >= 0) return;
            out[seen[entry.id]] = entry;
            return;
        }
        seen[entry.id] = out.length;
        out.push(entry);
    });
    return out;
}

module.exports = { parse: parse };
