// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// OneDrive as a drive: Microsoft Graph's drive API on the signed-in user's
// drive (https://learn.microsoft.com/graph/api/resources/onedrive), with
// the Microsoft identity platform's OAuth 2 and PKCE as a public client
// (Files.ReadWrite, offline_access, User.Read). Phoenix's app is an Entra
// app registration (docs/DEVELOPER-APPS.md), the same one Outlook and
// Teams will use (SYNERGY-MODERN.md 1.3).
//
//   list      GET /me/drive/root:/{path}:/children (@odata.nextLink pages)
//   stat      GET /me/drive/root:/{path}
//   download  the item's @microsoft.graph.downloadUrl (pre-authenticated,
//             a SharePoint host), with Range
//   upload    PUT .../content up to 4 MB; larger in an upload session
//             (createUploadSession, then Content-Range parts of a multiple
//             of 320 KiB)
//   mkdir     POST {parent}/children {folder: {}}; move: PATCH
//             {name, parentReference}; copy: not on the server (Graph's copy
//             is a background job: the file manager copies through the device)
//   remove    DELETE (to the OneDrive recycle bin)
//   search    GET /me/drive/root/search(q='...')
//   quota     GET /me/drive?$select=quota

"use strict";

var kit = require("@phoenix/connector-kit");
var N = require("./net");

var E = kit.FILE_ERRORS;
var GRAPH = "https://graph.microsoft.com/v1.0";
var SIMPLE_LIMIT = 4 * 1024 * 1024;
var PART = 327680;
var SELECT = "id,name,size,lastModifiedDateTime,eTag,cTag,file,folder,parentReference,@microsoft.graph.downloadUrl";

function graphError(res, what) {
    var b = N.jsonOf(res) || {};
    var code = String((b.error && b.error.code) || "");
    if (res.status === 409 || code === "nameAlreadyExists") return kit.fileError(E.EXISTS, what + ": already exists");
    if (code === "quotaLimitReached" || res.status === 507) return kit.fileError(E.QUOTA, what + ": your OneDrive is full");
    if (code === "itemNotFound") return kit.fileError(E.NOT_FOUND, what + ": not found");
    return kit.httpError(res.status, what, code + (b.error && b.error.message ? " " + b.error.message : ""));
}

/** opts: {token(), graph? (base address: the tests' server)}. */
function createGraph(ctx, opts) {
    var base = (opts.graph || GRAPH) + "/me/drive";
    var item = function (p) { return p === "/" ? base + "/root" : base + "/root:" + N.encodePath(p) + ":"; };
    var urls = {};

    function call(method, url, body, ok, headers) {
        return opts.token().then(function (t) {
            var h = Object.assign({ Authorization: "Bearer " + t, Accept: "application/json" }, headers || {});
            var r = { method: method, url: url, headers: h };
            if (body !== undefined) { r.body = typeof body === "string" ? body : JSON.stringify(body); h["Content-Type"] = "application/json"; }
            return N.send(ctx, r);
        }).then(function (res) {
            if ((ok || [200]).indexOf(res.status) < 0) throw graphError(res, method + " " + url.replace(/^.*\/me\/drive/, ""));
            return N.jsonOf(res) || {};
        });
    }

    function pathOf(m) {
        var parent = m.parentReference && m.parentReference.path;
        if (parent === undefined) return null;
        var dir = decodeURIComponent(String(parent).replace(/^\/drive(s\/[^/]+)?\/root:?/, "")) || "";
        return (dir === "/" ? "" : dir) + "/" + m.name;
    }
    function entryOf(m, path) {
        var dir = !!m.folder;
        var e = { name: m.name, path: path || pathOf(m) || "/" + m.name, type: dir ? "directory" : "file", size: dir ? 0 : Number(m.size) || 0,
                  mtime: Date.parse(m.lastModifiedDateTime || "") || 0, id: m.id };
        if (m.cTag || m.eTag) e.etag = m.cTag || m.eTag;
        if (m.file && m.file.mimeType) e.mimeType = m.file.mimeType;
        // The download address is pre-authenticated: kept here, never in an entry.
        if (m["@microsoft.graph.downloadUrl"]) urls[e.path] = m["@microsoft.graph.downloadUrl"];
        return e;
    }
    function joinPath(dir, name) { return (dir === "/" ? "" : dir) + "/" + name; }

    var drive = {
        list: function (p) {
            var out = [];
            function page(r) {
                (r.value || []).forEach(function (m) { out.push(entryOf(m, joinPath(p, m.name))); });
                if (r["@odata.nextLink"]) return call("GET", r["@odata.nextLink"]).then(page);
                return out;
            }
            return call("GET", item(p) + "/children?$top=200&$select=" + encodeURIComponent(SELECT)).then(page);
        },

        stat: function (p) {
            return call("GET", item(p) + "?$select=" + encodeURIComponent(SELECT)).then(function (m) {
                var e = entryOf(m, p);
                if (p === "/") e.name = "";
                return e;
            });
        },

        download: function (entry, sink, o) {
            var url = urls[entry.path] ? Promise.resolve(urls[entry.path])
                : drive.stat(entry.path).then(function (e) { return urls[e.path]; });
            return url.then(function (u) {
                if (!u) throw kit.fileError(E.IO, "OneDrive gave no download address for " + entry.path);
                // The address is pre-authenticated (and on another host): no token goes there.
                ctx.http.allowHost(new URL(u).host);
                return kit.downloadInRanges(entry.size, sink, o, function (start, end) {
                    return N.send(ctx, { method: "GET", url: u, headers: end >= 0 ? { Range: "bytes=" + start + "-" + end } : {}, binary: true });
                }, "download " + entry.path);
            });
        },

        upload: function (p, source, o) {
            var behavior = o.overwrite ? "replace" : "fail";
            if (source.size <= Math.min(SIMPLE_LIMIT, o.chunkSize)) {
                o.onProgress(0, source.size);
                return source.read(0, source.size).then(function (bytes) {
                    if (o.signal.aborted) throw kit.fileError(E.CANCELED, "Cancelled");
                    return opts.token().then(function (t) {
                        return N.send(ctx, { method: "PUT", url: item(p) + "/content?@microsoft.graph.conflictBehavior=" + behavior,
                                             headers: { Authorization: "Bearer " + t, "Content-Type": source.mimeType || "application/octet-stream" }, body: bytes });
                    });
                }).then(function (res) {
                    if (res.status !== 200 && res.status !== 201) throw graphError(res, "PUT " + p);
                    o.onProgress(source.size, source.size);
                    return entryOf(N.jsonOf(res) || {}, p);
                });
            }
            var chunk = Math.max(PART, Math.floor(o.chunkSize / PART) * PART), result = null;
            return call("POST", item(p) + "/createUploadSession", { item: { "@microsoft.graph.conflictBehavior": behavior } }).then(function (s) {
                var url = s.uploadUrl;
                if (!url) throw kit.fileError(E.IO, "OneDrive gave no upload address");
                ctx.http.allowHost(new URL(url).host);
                return kit.forEachChunk(source, Object.assign({}, o, { chunkSize: chunk }), function (bytes, offset) {
                    // The upload address carries its own authorization: no token goes there.
                    return N.send(ctx, { method: "PUT", url: url, body: bytes,
                                         headers: { "Content-Range": "bytes " + offset + "-" + (offset + bytes.length - 1) + "/" + source.size } })
                        .then(function (res) {
                            if (res.status === 202) return;
                            if (res.status === 200 || res.status === 201) { result = N.jsonOf(res); return; }
                            throw graphError(res, "upload " + p);
                        });
                }).catch(function (e) {
                    return N.send(ctx, { method: "DELETE", url: url }).catch(function () {}).then(function () { throw e; });
                });
            }).then(function () { return result ? entryOf(result, p) : drive.stat(p); });
        },

        mkdir: function (p) {
            var parent = p.replace(/\/[^/]*$/, "") || "/", name = p.slice(p.lastIndexOf("/") + 1);
            return call("POST", item(parent) + "/children", { name: name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }, [200, 201])
                .then(function (m) { return entryOf(m, p); });
        },

        move: function (from, to, o) {
            var parent = to.replace(/\/[^/]*$/, "") || "/", name = to.slice(to.lastIndexOf("/") + 1);
            var body = { name: name, parentReference: { path: "/drive/root:" + (parent === "/" ? "" : parent) } };
            return call("PATCH", item(from) + (o.overwrite ? "?@microsoft.graph.conflictBehavior=replace" : ""), body).then(function () {});
        },

        remove: function (p) { return call("DELETE", item(p), undefined, [204, 200]).then(function () {}); },

        search: function (query, so) {
            var q = String(query).replace(/'/g, "''");
            var scope = so.path === "/" ? base + "/root" : item(so.path);
            return call("GET", scope + "/search(q='" + encodeURIComponent(q) + "')?$top=" + so.limit + "&$select=" + encodeURIComponent(SELECT)).then(function (r) {
                return (r.value || []).map(function (m) { return entryOf(m); });
            });
        },

        quota: function () {
            return call("GET", base + "?$select=quota").then(function (d) {
                var q = d.quota || {};
                return q.total ? { used: Number(q.used) || 0, total: Number(q.total) } : { used: Number(q.used) || 0 };
            });
        }
    };
    return drive;
}

function whoAmI(ctx, token, graph) {
    return N.send(ctx, { method: "GET", url: (graph || GRAPH) + "/me?$select=userPrincipalName,mail,displayName,id",
                         headers: { Authorization: "Bearer " + token, Accept: "application/json" } }).then(function (res) {
        if (res.status !== 200) throw graphError(res, "GET /me");
        var b = N.jsonOf(res) || {};
        return { username: b.mail || b.userPrincipalName || b.displayName || b.id, id: b.id };
    });
}

module.exports = { createGraph: createGraph, whoAmI: whoAmI,
                   OAUTH: { authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
                            tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                            scope: "offline_access User.Read Files.ReadWrite" },
                   HOSTS: ["graph.microsoft.com", "*.sharepoint.com", "*.1drv.com", "*.files.1drv.com", "*.livefilestore.com", "api.onedrive.com"] };
