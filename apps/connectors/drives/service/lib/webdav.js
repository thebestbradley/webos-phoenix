// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A WebDAV drive (RFC 4918): any WebDAV server, and Nextcloud and ownCloud
// with their file roots (/remote.php/dav/files/<user>/). Signed in with the
// user name and an app password (HTTP Basic over https), or, for
// Nextcloud, the app password Login Flow v2 gives
// (https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2).
//
//   list, stat   PROPFIND (Depth 1, 0): getcontentlength, getlastmodified,
//                resourcetype, getetag, getcontenttype
//   download     GET with Range, chunk by chunk
//   upload       PUT (If-None-Match: * when not replacing); on Nextcloud a
//                file larger than a chunk goes in chunked upload v2
//                (MKCOL uploads/<user>/<id>, PUT 00001..., MOVE .file:
//                developer_manual/client_apis/WebDAV/chunking.html), so it
//                never sits in memory whole and a lost connection costs a
//                chunk; elsewhere one PUT (up to 256 MB)
//   mkdir        MKCOL; move, copy: MOVE, COPY with Destination and Overwrite
//   remove       DELETE (a folder with what is in it)
//   search       Nextcloud's SEARCH (RFC 5323 basicsearch) on the user's files
//   quota        quota-used-bytes, quota-available-bytes (RFC 4331)

"use strict";

var kit = require("@phoenix/connector-kit");
var synckit = require("@phoenix/synckit");
var H = require("./hash");
var N = require("./net");

var X = synckit.xml;
var DAV = "DAV:";
var OC = "http://owncloud.org/ns";
var NC = "http://nextcloud.org/ns";
var E = kit.FILE_ERRORS;
var SINGLE_PUT_LIMIT = 256 * 1024 * 1024;

var PROPS = "<d:prop><d:getcontentlength/><d:getlastmodified/><d:resourcetype/><d:getetag/><d:getcontenttype/><oc:size/><oc:permissions/></d:prop>";
var PROPFIND = "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\" xmlns:oc=\"" + OC + "\">" + PROPS + "</d:propfind>";
var QUOTA = "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:quota-used-bytes/><d:quota-available-bytes/></d:prop></d:propfind>";

// The files root of a Nextcloud or ownCloud user.
function filesRoot(server, user) {
    return String(server).replace(/\/+$/, "") + "/remote.php/dav/files/" + encodeURIComponent(user) + "/";
}

function davError(res) {
    var t = N.textOf(res);
    var m = /<s:message>([^<]*)<\/s:message>/.exec(t);
    return m ? m[1] : "";
}

/**
 * opts: {root (the drive's top folder URL), user, password, flavor:
 * "nextcloud" | "owncloud" | "webdav"}.
 */
function createWebdav(ctx, opts) {
    var root = String(opts.root).replace(/\/*$/, "/");
    var rootUrl = new URL(root);
    var origin = rootUrl.origin;
    var rootPath = decodeURIComponent(rootUrl.pathname).replace(/\/+$/, "");
    var auth = "Basic " + H.base64(H.utf8((opts.user || "") + ":" + (opts.password || "")));

    function url(p) { return root.replace(/\/$/, "") + N.encodePath(p === "/" ? "/" : p); }
    function req(method, p, headers, body, extra) {
        var h = { Authorization: auth };
        Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
        var r = { method: method, url: typeof p === "string" && /^https?:/.test(p) ? p : url(p), headers: h };
        if (body !== undefined) r.body = body;
        Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
        return N.send(ctx, r);
    }

    // A multistatus response -> entries, the folder asked for first.
    function entries(res) {
        var doc = X.parse(N.textOf(res));
        return X.children(doc, DAV, "response").map(function (r) {
            var href = X.text(X.child(r, DAV, "href"));
            var p;
            try { p = decodeURIComponent(new URL(href, origin).pathname); } catch (e) { p = href; }
            p = p.replace(/\/+$/, "");
            if (p.indexOf(rootPath) !== 0) return null;
            var rel = p.slice(rootPath.length) || "/";
            var prop = null;
            X.children(r, DAV, "propstat").forEach(function (ps) {
                if (/\s200\s?/.test(X.text(X.child(ps, DAV, "status"))) || !X.child(ps, DAV, "status")) prop = X.child(ps, DAV, "prop") || prop;
            });
            var get = function (ns, name) { return prop ? X.child(prop, ns, name) : null; };
            var dir = !!(get(DAV, "resourcetype") && X.child(get(DAV, "resourcetype"), DAV, "collection"));
            var size = Number(X.text(get(DAV, "getcontentlength")) || (dir ? 0 : 0)) || 0;
            var mtime = Date.parse(X.text(get(DAV, "getlastmodified"))) || 0;
            var perms = get(OC, "permissions");
            var e = { name: rel === "/" ? "" : rel.slice(rel.lastIndexOf("/") + 1), path: rel, type: dir ? "directory" : "file",
                      size: dir ? 0 : size, mtime: mtime };
            var etag = X.text(get(DAV, "getetag"));
            if (etag) e.etag = etag;
            var ct = X.text(get(DAV, "getcontenttype"));
            if (ct && !dir) e.mimeType = ct.replace(/;.*$/, "");
            // ownCloud and Nextcloud: W (file) or CK (folder) missing = read only (a share).
            if (perms && X.text(perms) && !/[WCK]/.test(X.text(perms))) e.readOnly = true;
            return e;
        }).filter(Boolean);
    }

    function propfind(p, depth) {
        return req("PROPFIND", p, { Depth: String(depth), "Content-Type": "application/xml; charset=utf-8" }, PROPFIND).then(function (res) {
            if (res.status === 404) throw kit.fileError(E.NOT_FOUND, "No such file or folder: " + p);
            N.expect(res, [207], "PROPFIND " + p, davError);
            return entries(res);
        });
    }

    var drive = {
        list: function (p) {
            return propfind(p, 1).then(function (list) {
                var self = list.filter(function (e) { return e.path === p; })[0];
                if (self && self.type !== "directory") throw kit.fileError(E.NOT_DIR, "Not a folder: " + p);
                return list.filter(function (e) { return e.path !== p; });
            });
        },

        stat: function (p) {
            return propfind(p, 0).then(function (list) {
                var e = list.filter(function (x) { return x.path === p; })[0] || list[0];
                if (!e) throw kit.fileError(E.NOT_FOUND, "No such file or folder: " + p);
                if (p === "/") e.name = "";
                return e;
            });
        },

        download: function (entry, sink, o) {
            return kit.downloadInRanges(entry.size, sink, o, function (start, end) {
                var h = end >= 0 ? { Range: "bytes=" + start + "-" + end } : {};
                return req("GET", entry.path, h, undefined, { binary: true });
            }, "GET " + entry.path);
        },

        upload: function (p, source, o) {
            var guard = o.overwrite ? {} : { "If-None-Match": "*" };
            var put;
            if (opts.flavor === "nextcloud" && source.size > o.chunkSize) put = chunked(p, source, o);
            else {
                if (source.size > SINGLE_PUT_LIMIT)
                    return Promise.reject(kit.fileError(E.TOO_LARGE, "This server takes files of up to 256 MB from Phoenix (it has no chunked upload)"));
                o.onProgress(0, source.size);
                put = source.read(0, source.size).then(function (bytes) {
                    if (o.signal.aborted) throw kit.fileError(E.CANCELED, "Cancelled");
                    return req("PUT", p, Object.assign({ "Content-Type": source.mimeType || "application/octet-stream" }, guard), bytes);
                }).then(function (res) {
                    if (res.status === 412) throw kit.fileError(E.EXISTS, "Already exists: " + p);
                    if (res.status === 409) throw kit.fileError(E.NOT_FOUND, "No such folder: " + (p.replace(/\/[^/]*$/, "") || "/"));
                    N.expect(res, [200, 201, 204], "PUT " + p, davError);
                    o.onProgress(source.size, source.size);
                });
            }
            return put.then(function () { return drive.stat(p); });
        },

        mkdir: function (p) {
            return req("MKCOL", p).then(function (res) {
                if (res.status === 405) throw kit.fileError(E.EXISTS, "Already exists: " + p);
                if (res.status === 409) throw kit.fileError(E.NOT_FOUND, "No such folder: " + (p.replace(/\/[^/]*$/, "") || "/"));
                N.expect(res, [201], "MKCOL " + p, davError);
            });
        },

        move: function (from, to, o) { return moveOrCopy("MOVE", from, to, o); },
        copy: function (from, to, o) { return moveOrCopy("COPY", from, to, o); },

        remove: function (p) {
            return req("DELETE", p).then(function (res) {
                N.expect(res, [200, 204], "DELETE " + p, davError);
            });
        },

        quota: function () {
            return req("PROPFIND", "/", { Depth: "0", "Content-Type": "application/xml; charset=utf-8" }, QUOTA).then(function (res) {
                N.expect(res, [207], "PROPFIND quota", davError);
                var doc = X.parse(N.textOf(res));
                var used = 0, avail = -1;
                X.children(doc, DAV, "response").slice(0, 1).forEach(function (r) {
                    X.children(r, DAV, "propstat").forEach(function (ps) {
                        var prop = X.child(ps, DAV, "prop");
                        var u = X.child(prop, DAV, "quota-used-bytes"), a = X.child(prop, DAV, "quota-available-bytes");
                        if (u && X.text(u)) used = Number(X.text(u)) || 0;
                        if (a && X.text(a)) avail = Number(X.text(a));
                    });
                });
                // A negative available means "unlimited" or "not known" (Nextcloud: -3).
                return avail >= 0 ? { used: used, total: used + avail } : { used: used };
            });
        }
    };

    function moveOrCopy(method, from, to, o) {
        return req(method, from, { Destination: url(to), Overwrite: o.overwrite ? "T" : "F" }).then(function (res) {
            if (res.status === 412) throw kit.fileError(E.EXISTS, "Already exists: " + to);
            if (res.status === 409) throw kit.fileError(E.NOT_FOUND, "No such folder: " + (to.replace(/\/[^/]*$/, "") || "/"));
            N.expect(res, [201, 204], method + " " + from, davError);
        });
    }

    // Nextcloud's chunked upload v2: the chunks into a folder of uploads/,
    // then one MOVE puts the file together where it goes.
    function chunked(p, source, o) {
        var dest = url(p);
        var dir = origin + "/remote.php/dav/uploads/" + encodeURIComponent(opts.user) + "/phoenix-" + N.randomId();
        var headers = { Destination: dest, "OC-Total-Length": String(source.size) };
        var n = 0;
        return req("MKCOL", dir, headers).then(function (res) {
            N.expect(res, [201], "MKCOL " + dir.replace(/^.*\/uploads\//, "uploads/"), davError);
            return kit.forEachChunk(source, o, function (bytes) {
                n++;
                var name = ("0000" + n).slice(-5);
                return req("PUT", dir + "/" + name, Object.assign({ "Content-Type": "application/octet-stream" }, headers), bytes).then(function (r) {
                    N.expect(r, [201, 204], "PUT chunk " + n, davError);
                });
            });
        }).then(function () {
            var h = Object.assign({ Overwrite: o.overwrite ? "T" : "F" }, headers);
            return req("MOVE", dir + "/.file", h).then(function (res) {
                if (res.status === 412) throw kit.fileError(E.EXISTS, "Already exists: " + p);
                N.expect(res, [201, 204], "MOVE .file", davError);
            });
        }).catch(function (e) {
            // The chunks go; the server would remove them after a while anyway.
            return req("DELETE", dir).catch(function () {}).then(function () { throw e; });
        });
    }

    if (opts.flavor === "nextcloud") {
        drive.search = function (query, so) {
            var scope = "/files/" + opts.user + (so.path === "/" ? "" : so.path);
            var words = String(query).trim().split(/\s+/).filter(Boolean);
            var where = words.map(function (w) {
                return "<d:like><d:prop><d:displayname/></d:prop><d:literal>%" + X.escape(w) + "%</d:literal></d:like>";
            });
            var body = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><d:searchrequest xmlns:d=\"DAV:\" xmlns:oc=\"" + OC + "\" xmlns:nc=\"" + NC + "\">" +
                "<d:basicsearch><d:select>" + PROPS + "</d:select><d:from><d:scope><d:href>" + X.escape(scope) +
                "</d:href><d:depth>infinity</d:depth></d:scope></d:from><d:where>" +
                (where.length > 1 ? "<d:and>" + where.join("") + "</d:and>" : where[0]) +
                "</d:where><d:orderby/><d:limit><d:nresults>" + so.limit + "</d:nresults></d:limit></d:basicsearch></d:searchrequest>";
            return req("SEARCH", origin + "/remote.php/dav/", { "Content-Type": "text/xml; charset=utf-8" }, body).then(function (res) {
                N.expect(res, [207], "SEARCH", davError);
                return entries(res).filter(function (e) { return e.path !== "/"; });
            });
        };
    }
    return drive;
}

module.exports = { createWebdav: createWebdav, filesRoot: filesRoot };
