// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The webOS Archive's App Museum II (https://appcatalog.webosarchive.org):
// the recovered HP/Palm App Catalog and newer homebrew, as an add-on
// catalog of "Classics". Its public web service (webOSArchive/
// webos-catalog-service, WebService/):
//
//   getMuseumMaster.php?key&category&count&page&sort=recommended&adult=false
//       -> {data: [app], indices}      (key: any session key)
//   getSearchResults.php?app=<words>   -> {data: [app]}
//   getMuseumDetails.php?id=<n>        -> {publicApplicationId, version,
//       description, filename, appSize, homeURL, images, ...}
//   countAppDownload.php?appid&source  counts a download
//   getConfig.php                      -> {package_host, image_host, ...}
//   images: <url>AppImages/<appIcon>
//   packages: http://<package_host>/<filename> (appstorage.webosarchive.org/packages)
//
// (app: {id, title, author, summary, appIcon, appIconBig, category, Pre3,
// TouchPad, LuneOS, Adult, ...}). The packages are the original apps,
// offered by the archive for preservation; they are not signed, and most are
// Mojo or Enyo 1.0 apps for a 2011 phone, so each is checked before it is
// installed (packagesservice.js).

"use strict";

var DEFAULT_URL = "https://appcatalog.webosarchive.org/";

function createAppMuseum(opts) {
    var request = opts.request;
    var base = String(opts.url || DEFAULT_URL).replace(/\/*$/, "/");
    var sourceId = opts.sourceId || "appmuseum";
    var session = "phoenix-" + Math.random().toString(36).slice(2, 10);

    function get(path) {
        return Promise.resolve(request({ method: "GET", url: base + path, headers: { Accept: "application/json" } })).then(function (res) {
            if (res.status !== 200) {
                var e = new Error("The App Museum answered HTTP " + res.status);
                e.code = "BAD_SERVER";
                throw e;
            }
            try { return JSON.parse(res.body); } catch (x) {
                var e2 = new Error("The App Museum's answer is not JSON");
                e2.code = "BAD_SERVER";
                throw e2;
            }
        });
    }

    function image(p) { return p ? base + "AppImages/" + String(p).replace(/^\/+/, "") : ""; }

    // Where the packages are, as the archive says (its packages are served
    // over plain HTTP for the old phones; the catalog's own pages over HTTPS).
    var packageHost = null;
    function packages() {
        if (!packageHost) packageHost = get("WebService/getConfig.php").then(function (c) {
            if (!c || !c.package_host) throw Object.assign(new Error("The App Museum did not say where its packages are"), { code: "BAD_SERVER" });
            return "http://" + String(c.package_host).replace(/^https?:\/\//, "").replace(/\/*$/, "/");
        }, function (e) { packageHost = null; throw e; });
        return packageHost;
    }

    function summaryOf(a) {
        return {
            id: "appmuseum." + a.id, museumId: a.id, sourceId: sourceId, kind: "classic",
            title: String(a.title || ""), developer: { name: String(a.author || ""), url: "" },
            summary: String(a.summary || "").replace(/\s+/g, " ").trim(), description: "",
            categories: a.category ? [String(a.category)] : [], icon: image(a.appIconBig || a.appIcon), screenshots: [],
            license: "", homepage: "", donation: "", featured: !!a.inCuratorsChoice,
            rating: typeof a.starRating === "number" ? { stars: a.starRating, count: a.reviewCount | 0 } : null,
            version: "", adult: !!a.Adult,
            devices: ["Pixi", "Pre", "Pre2", "Pre3", "Veer", "TouchPad", "LuneOS"].filter(function (d) { return a[d]; })
        };
    }

    return {
        sourceId: sourceId,
        browse: function (p) {
            p = p || {};
            var q = "WebService/getMuseumMaster.php?key=" + session + "&count=" + (p.count || 20) + "&page=" + (p.page || 0) +
                "&sort=recommended&adult=" + (p.adult ? "true" : "false") +
                (p.category ? "&category=" + encodeURIComponent(p.category) : "");
            return get(q).then(function (r) { return (r.data || []).map(summaryOf); });
        },
        search: function (words, adult) {
            return get("WebService/getSearchResults.php?app=" + encodeURIComponent(words)).then(function (r) {
                return (r.data || []).filter(function (a) { return adult || !a.Adult; }).map(summaryOf);
            });
        },
        details: function (museumId) {
            return Promise.all([get("WebService/getMuseumDetails.php?id=" + encodeURIComponent(museumId)), packages()]).then(function (r) {
                var d = r[0], host = r[1];
                var shots = [];
                Object.keys(d.images || {}).forEach(function (k) {
                    var im = d.images[k];
                    if (im && (im.screenshot || im.thumbnail)) shots.push(image(im.screenshot || im.thumbnail));
                });
                return {
                    appId: d.publicApplicationId || "", version: d.version || "", description: d.description || "",
                    homepage: d.homeURL || "", size: d.appSize || 0, filename: d.filename || "", screenshots: shots.slice(0, 8),
                    url: d.filename ? host + encodeURIComponent(d.filename) : ""
                };
            });
        },
        countDownload: function (museumId) {
            return Promise.resolve(request({ method: "GET",
                url: base + "WebService/countAppDownload.php?appid=" + encodeURIComponent(museumId) + "&source=webOS%20Phoenix" }))
                .then(null, function () { /* only a courtesy */ });
        }
    };
}

module.exports = { createAppMuseum: createAppMuseum, DEFAULT_URL: DEFAULT_URL };
