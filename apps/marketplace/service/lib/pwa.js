// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A web app (PWA) as a webOS app (docs/APP-STORE.md, 1.2): its web app
// manifest (W3C Web Application Manifest) becomes an appinfo.json whose
// "main" is the site's start_url, with the site's own icons, packaged as
// an .ipk the installer takes like any other. Its card then opens the site;
// it gets its own launcher icon, cards and Just Type entry.
//
//   parseManifest(text, manifestUrl, pageUrl) -> {name, shortName, startUrl, scope,
//       display, themeColor, backgroundColor, icons: [{src, sizes, type,
//       purpose, size}], id}, or throws (code BAD_MANIFEST); pageUrl is the
//       page that links the manifest (the site; the manifest's own URL if not
//       given), which matters when the manifest is kept on a CDN
//   pickIcons(manifest) -> {small, large}: the icons to fetch (small for the
//       launcher, at least 64 px if there is one; large for dense screens
//       and the loading card, the biggest)
//   appinfo(entry, manifest, iconNames) -> appinfo.json's object
//   icoPng(bytes) -> the PNG an ICO holds as its biggest picture, or null

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

function parseManifest(text, manifestUrl, pageUrl) {
    var m;
    try { m = typeof text === "string" ? JSON.parse(text) : text; } catch (e) { throw fail("The site's manifest is not valid JSON"); }
    if (!m || typeof m !== "object") throw fail("The site's manifest is empty");
    var base = new URL(manifestUrl);
    var page = new URL(pageUrl || manifestUrl);
    var start = new URL(typeof m.start_url === "string" && m.start_url ? m.start_url : ".", base);
    var scope = new URL(typeof m.scope === "string" && m.scope ? m.scope : ".", start);
    // As browsers do: a start URL on another origin than the page, or
    // outside the scope, makes the manifest's start_url and scope fall back
    // (W3C Web Application Manifest, "processing the start_url member": the
    // page's origin, not the manifest's, so open.spotifycdn.com's manifest
    // can start at open.spotify.com).
    if (start.origin !== page.origin) start = new URL("/", page);
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
    // The catalog's own icon for a site whose icons are broken (iconGenerated).
    if (/svg/i.test(type) || /\.svg(\?|$)/i.test(src)) return "svg";
    return "png";
}

// An icon in the ICO format (a site's favicon.ico) as the launcher can show
// it: Qt's ICO reader gives the file's first picture, often its 16 px one
// (Slack's: 16, 32, 48, then 256 px), so the PNG its biggest picture is (a
// 256 px one in an ICO is a PNG, as Windows Vista made it) is used instead.
// null for anything else, or an ICO whose biggest picture is a bitmap (then
// kept as it is).
function icoPng(bytes) {
    if (!bytes || bytes.length < 6 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 1 || bytes[3] !== 0) return null;
    var u32 = function (i) { return (bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16 | bytes[i + 3] << 24) >>> 0; };
    var best = null;
    for (var n = bytes[4] | bytes[5] << 8, i = 0; i < n && 6 + 16 * i + 16 <= bytes.length; i++) {
        var d = 6 + 16 * i, size = Math.min(bytes[d] || 256, bytes[d + 1] || 256), len = u32(d + 8), at = u32(d + 12);
        if (len < 8 || at + len > bytes.length || (best && best.size >= size)) continue;
        best = { size: size, at: at, len: len };
    }
    if (!best) return null;
    var png = bytes.slice(best.at, best.at + best.len);
    return png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47 ? png : null;
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

module.exports = { parseManifest: parseManifest, pickIcons: pickIcons, appinfo: appinfo, extOf: extOf, icoPng: icoPng };
