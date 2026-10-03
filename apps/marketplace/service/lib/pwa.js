// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A web app (PWA) as a webOS app (docs/APP-STORE.md, 1.2): its web app
// manifest (W3C Web Application Manifest) becomes an appinfo.json whose
// "main" is the site's start_url, with the site's own icons, packaged as
// an .ipk the installer takes like any other. Its card then opens the site;
// it gets its own launcher icon, cards and Just Type entry.
//
//   parseManifest(text, manifestUrl) -> {name, shortName, startUrl, scope,
//       display, themeColor, backgroundColor, icons: [{src, sizes, type,
//       purpose, size}], id}, or throws (code BAD_MANIFEST)
//   pickIcons(manifest) -> {small, large}: the icons to fetch (small for the
//       launcher, at least 64 px if there is one; large for dense screens
//       and the loading card, the biggest)
//   appinfo(entry, manifest, iconNames) -> appinfo.json's object

"use strict";

function fail(text) {
    var e = new Error(text);
    e.code = "BAD_MANIFEST";
    return e;
}

function largest(sizes) {
    if (!sizes || typeof sizes !== "string") return 0;
    if (/\bany\b/i.test(sizes)) return 1024;
    var best = 0;
    sizes.split(/\s+/).forEach(function (s) {
        var m = /^(\d+)x(\d+)$/i.exec(s);
        if (m) best = Math.max(best, Math.min(+m[1], +m[2]));
    });
    return best;
}

function parseManifest(text, manifestUrl) {
    var m;
    try { m = typeof text === "string" ? JSON.parse(text) : text; } catch (e) { throw fail("The site's manifest is not valid JSON"); }
    if (!m || typeof m !== "object") throw fail("The site's manifest is empty");
    var base = new URL(manifestUrl);
    var start = new URL(typeof m.start_url === "string" && m.start_url ? m.start_url : ".", base);
    var scope = new URL(typeof m.scope === "string" && m.scope ? m.scope : ".", start);
    // As browsers do: a start URL on another origin, or outside the scope,
    // makes the manifest's start_url and scope fall back.
    if (start.origin !== base.origin) start = new URL("/", base);
    if (scope.origin !== start.origin || start.href.indexOf(scope.href) !== 0) scope = new URL(".", start);
    if (start.protocol !== "https:" && !/^(127\.0\.0\.1|localhost)$/.test(start.hostname))
        throw fail("A web app has to be served over HTTPS");
    var icons = (Array.isArray(m.icons) ? m.icons : []).map(function (i) {
        if (!i || typeof i.src !== "string") return null;
        var purpose = typeof i.purpose === "string" ? i.purpose : "any";
        return { src: new URL(i.src, base).href, sizes: i.sizes || "", type: i.type || "", purpose: purpose, size: largest(i.sizes) };
    }).filter(function (i) {
        return i && /^https?:/.test(i.src) && /\bany\b/.test(i.purpose) && !/svg/.test(i.type) && !/\.svg(\?|$)/i.test(i.src);
    });
    var name = typeof m.name === "string" ? m.name.trim() : "";
    var shortName = typeof m.short_name === "string" ? m.short_name.trim() : "";
    if (!name && !shortName) throw fail("The site's manifest has no name");
    return {
        id: typeof m.id === "string" ? new URL(m.id, start).href : start.href,
        name: name || shortName, shortName: shortName || name,
        startUrl: start.href, scope: scope.href,
        display: typeof m.display === "string" ? m.display : "browser",
        themeColor: typeof m.theme_color === "string" ? m.theme_color : "",
        backgroundColor: typeof m.background_color === "string" ? m.background_color : "",
        icons: icons
    };
}

function pickIcons(manifest) {
    var icons = manifest.icons.slice().sort(function (a, b) { return a.size - b.size; });
    if (!icons.length) return { small: null, large: null };
    var small = icons.filter(function (i) { return i.size >= 64; })[0] || icons[icons.length - 1];
    var large = icons[icons.length - 1];
    return { small: small, large: large.size > small.size ? large : null };
}

function extOf(type, src) {
    if (/png/i.test(type) || /\.png(\?|$)/i.test(src)) return "png";
    if (/webp/i.test(type) || /\.webp(\?|$)/i.test(src)) return "webp";
    if (/jpe?g/i.test(type) || /\.jpe?g(\?|$)/i.test(src)) return "jpg";
    if (/x-icon|vnd\.microsoft/i.test(type) || /\.ico(\?|$)/i.test(src)) return "ico";
    return "png";
}

// entry: the catalog's (id, title, version, developer); iconNames: {icon,
// large} the files the package carries.
function appinfo(entry, manifest, iconNames) {
    var info = {
        id: entry.id,
        version: entry.version || "1.0.0",
        vendor: (entry.developer && entry.developer.name) || new URL(manifest.startUrl).hostname,
        type: "web",
        main: manifest.startUrl,
        title: entry.title || manifest.shortName,
        icon: iconNames.icon || "icon.png",
        uiRevision: 2,
        phoenix: {
            pwa: { manifest: entry.pwa.manifest, scope: manifest.scope, display: manifest.display,
                   themeColor: manifest.themeColor, backgroundColor: manifest.backgroundColor }
        }
    };
    if (iconNames.large) info.splashicon = iconNames.large;
    return info;
}

module.exports = { parseManifest: parseManifest, pickIcons: pickIcons, appinfo: appinfo, extOf: extOf };
