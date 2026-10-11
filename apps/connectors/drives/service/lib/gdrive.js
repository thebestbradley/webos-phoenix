// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Google Drive as a drive: the Drive API v3
// (https://developers.google.com/drive/api/reference/rest/v3), signed in
// with Google's OAuth 2 for installed apps (PKCE; Google's "desktop app"
// client has a secret that is not secret, docs/DEVELOPER-APPS.md).
//
// The scope is drive.file by default: Phoenix sees the files it made or
// that were opened with it, and nothing else. It needs no verification by
// Google beyond the consent screen. Seeing the whole drive (the "drive"
// scope) is restricted: Google's verification and a yearly security
// assessment (SYNERGY-MODERN.md 3.3, open question 2). The build setting
// googledrive.scope = "drive" turns it on for a registration that has passed.
//
// Drive is a graph of ids, not paths: a path is found name by name from
// "root" (one listing per folder, kept for the rest of the call). Google's
// own documents (Docs, Sheets, Slides) are downloaded as .docx, .xlsx,
// .pptx (files.export) and are read only here.
//
//   list      files.list q="'<id>' in parents and trashed=false"
//   download  files.get alt=media with Range (export for Google's documents)
//   upload    multipart upload up to a chunk; larger a resumable upload
//             (uploadType=resumable, Content-Range parts of 256 KiB multiples,
//             308 until the last); a file there already gets a new version
//   mkdir     files.create, mimeType application/vnd.google-apps.folder
//   move      files.update addParents / removeParents / name; copy: files.copy
//   remove    to the trash (files.update trashed=true): Drive keeps it 30 days
//   search    files.list q="name contains '...'"
//   quota     about.get storageQuota

"use strict";

var kit = require("@phoenix/connector-kit");
var N = require("./net");

var E = kit.FILE_ERRORS;
var API = "https://www.googleapis.com/drive/v3";
var UPLOAD = "https://www.googleapis.com/upload/drive/v3";
var FOLDER = "application/vnd.google-apps.folder";
var FIELDS = "id,name,mimeType,size,modifiedTime,md5Checksum,version,parents,capabilities(canEdit)";
var EXPORTS = {
    "application/vnd.google-apps.document": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
    "application/vnd.google-apps.spreadsheet": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
    "application/vnd.google-apps.presentation": ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
    "application/vnd.google-apps.drawing": ["image/png", ".png"]
};
var RESUMABLE_PART = 262144;

function q(s) { return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }

function driveError(res, what) {
    var b = N.jsonOf(res) || {};
    var reason = String((b.error && b.error.errors && b.error.errors[0] && b.error.errors[0].reason) || (b.error && b.error.status) || "");
    if (/storageQuotaExceeded|quotaExceeded/.test(reason)) return kit.fileError(E.QUOTA, what + ": your Google Drive is full");
    if (res.status === 404 || reason === "notFound") return kit.fileError(E.NOT_FOUND, what + ": not found");
    if (/rateLimitExceeded|userRateLimitExceeded/.test(reason)) return kit.httpError(429, what, reason);
    return kit.httpError(res.status, what, reason || (b.error && b.error.message) || "");
}

/** opts: {token(), api?, upload? (the tests' server)}. */
function createGdrive(ctx, opts) {
    var api = opts.api || API, upload = opts.upload || UPLOAD;
    var ids = { "/": "root" };

    function call(method, url, body, ok, headers) {
        return opts.token().then(function (t) {
            var h = Object.assign({ Authorization: "Bearer " + t, Accept: "application/json" }, headers || {});
            var r = { method: method, url: url, headers: h };
            if (body !== undefined) {
                if (body instanceof Uint8Array || typeof body === "string") r.body = body;
                else { r.body = JSON.stringify(body); h["Content-Type"] = "application/json; charset=UTF-8"; }
            }
            return N.send(ctx, r);
        }).then(function (res) {
            if ((ok || [200]).indexOf(res.status) < 0) throw driveError(res, method + " " + url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, ""));
            return res;
        });
    }
    function json(method, url, body, ok) { return call(method, url, body, ok).then(function (r) { return N.jsonOf(r) || {}; }); }

    function children(id, extra) {
        var out = [];
        function page(token) {
            var url = api + "/files?q=" + encodeURIComponent(q(id) + " in parents and trashed = false" + (extra || "")) +
                "&fields=" + encodeURIComponent("nextPageToken,files(" + FIELDS + ")") + "&pageSize=1000&spaces=drive" +
                (token ? "&pageToken=" + encodeURIComponent(token) : "");
            return json("GET", url).then(function (r) {
                out = out.concat(r.files || []);
                return r.nextPageToken ? page(r.nextPageToken) : out;
            });
        }
        return page(null);
    }

    // The name a file shows under (Google's documents: with the extension they download as).
    function shownName(m) { var x = EXPORTS[m.mimeType]; return x && !/\.\w+$/.test(m.name) ? m.name + x[1] : m.name; }

    function entryOf(m, path) {
        var dir = m.mimeType === FOLDER;
        var e = { name: path === "/" ? "" : shownName(m), path: path, type: dir ? "directory" : "file", size: dir ? 0 : Number(m.size) || 0,
                  mtime: Date.parse(m.modifiedTime || "") || 0, id: m.id };
        if (m.md5Checksum || m.version) e.etag = m.md5Checksum || String(m.version);
        if (!dir) e.mimeType = EXPORTS[m.mimeType] ? EXPORTS[m.mimeType][0] : m.mimeType;
        if (EXPORTS[m.mimeType] || (m.capabilities && m.capabilities.canEdit === false)) e.readOnly = true;
        meta[path] = m;
        return e;
    }
    var meta = {};

    // The metadata of a path, name by name from the root.
    function resolve(p) {
        if (meta[p]) return Promise.resolve(meta[p]);
        if (p === "/") return json("GET", api + "/files/root?fields=" + encodeURIComponent(FIELDS)).then(function (m) { meta["/"] = m; return m; });
        var parent = p.replace(/\/[^/]*$/, "") || "/", name = p.slice(p.lastIndexOf("/") + 1);
        return resolve(parent).then(function (pm) {
            if (pm.mimeType !== FOLDER) throw kit.fileError(E.NOT_DIR, "Not a folder: " + parent);
            return children(pm.id);
        }).then(function (list) {
            list.forEach(function (m) { var cp = (parent === "/" ? "" : parent) + "/" + shownName(m); if (!meta[cp]) meta[cp] = m; });
            if (!meta[p]) throw kit.fileError(E.NOT_FOUND, "No such file or folder: " + p);
            return meta[p];
        });
    }
    function exists(p) { return resolve(p).then(function () { return true; }, function (e) { if (e.code === E.NOT_FOUND) return false; throw e; }); }

    function multipartBody(metadata, bytes, type) {
        var boundary = "phoenix" + N.randomId();
        return { type: "multipart/related; boundary=" + boundary,
                 body: N.concat(["--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) +
                                 "\r\n--" + boundary + "\r\nContent-Type: " + type + "\r\n\r\n", bytes, "\r\n--" + boundary + "--\r\n"]) };
    }

    var drive = {
        list: function (p) {
            return resolve(p).then(function (m) {
                if (m.mimeType !== FOLDER) throw kit.fileError(E.NOT_DIR, "Not a folder: " + p);
                return children(m.id);
            }).then(function (list) {
                return list.map(function (m) { return entryOf(m, (p === "/" ? "" : p) + "/" + shownName(m)); });
            });
        },

        stat: function (p) { return resolve(p).then(function (m) { return entryOf(m, p); }); },

        download: function (entry, sink, o) {
            return resolve(entry.path).then(function (m) {
                var x = EXPORTS[m.mimeType];
                if (x) {
                    // A Google document: exported whole (its size is not known before).
                    o.onProgress(0, 0);
                    return opts.token().then(function (t) {
                        return N.send(ctx, { method: "GET", url: api + "/files/" + encodeURIComponent(m.id) + "/export?mimeType=" + encodeURIComponent(x[0]),
                                             headers: { Authorization: "Bearer " + t }, binary: true });
                    }).then(function (res) {
                        if (res.status !== 200) throw driveError(res, "export " + entry.path);
                        return sink.write(res.bytes || new Uint8Array(0));
                    });
                }
                return kit.downloadInRanges(entry.size, sink, o, function (start, end) {
                    return opts.token().then(function (t) {
                        var h = { Authorization: "Bearer " + t };
                        if (end >= 0) h.Range = "bytes=" + start + "-" + end;
                        return N.send(ctx, { method: "GET", url: api + "/files/" + encodeURIComponent(m.id) + "?alt=media", headers: h, binary: true });
                    });
                }, "download " + entry.path);
            });
        },

        upload: function (p, source, o) {
            var parent = p.replace(/\/[^/]*$/, "") || "/", name = p.slice(p.lastIndexOf("/") + 1);
            var type = source.mimeType || "application/octet-stream";
            return Promise.all([resolve(parent), exists(p)]).then(function (r) {
                var pm = r[0], there = r[1] ? meta[p] : null;
                if (pm.mimeType !== FOLDER) throw kit.fileError(E.NOT_DIR, "Not a folder: " + parent);
                if (there && !o.overwrite) throw kit.fileError(E.EXISTS, "Already exists: " + p);
                if (there && there.mimeType === FOLDER) throw kit.fileError(E.IS_DIR, "A folder has this name: " + p);
                var target = there ? upload + "/files/" + encodeURIComponent(there.id) : upload + "/files";
                var method = there ? "PATCH" : "POST";
                var metadata = there ? {} : { name: name, parents: [pm.id] };
                if (source.size <= o.chunkSize) {
                    o.onProgress(0, source.size);
                    return source.read(0, source.size).then(function (bytes) {
                        if (o.signal.aborted) throw kit.fileError(E.CANCELED, "Cancelled");
                        var mp = multipartBody(metadata, bytes, type);
                        return call(method, target + "?uploadType=multipart&fields=" + encodeURIComponent(FIELDS), mp.body, [200], { "Content-Type": mp.type });
                    }).then(function (res) {
                        o.onProgress(source.size, source.size);
                        delete meta[p];
                        return entryOf(N.jsonOf(res), p);
                    });
                }
                // Resumable: a session, then parts (multiples of 256 KiB), 308 until the last.
                var chunk = Math.max(RESUMABLE_PART, Math.floor(o.chunkSize / RESUMABLE_PART) * RESUMABLE_PART), done = null;
                return call(method, target + "?uploadType=resumable&fields=" + encodeURIComponent(FIELDS), metadata, [200], {
                    "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(source.size)
                }).then(function (res) {
                    var session = res.headers.location;
                    if (!session) throw kit.fileError(E.IO, "Google Drive gave no upload address");
                    return kit.forEachChunk(source, Object.assign({}, o, { chunkSize: chunk }), function (bytes, offset) {
                        return opts.token().then(function (t) {
                            return N.send(ctx, { method: "PUT", url: session, body: bytes, headers: {
                                Authorization: "Bearer " + t,
                                "Content-Range": "bytes " + offset + "-" + (offset + bytes.length - 1) + "/" + source.size } });
                        }).then(function (r2) {
                            if (r2.status === 308) return;
                            if (r2.status === 200 || r2.status === 201) { done = N.jsonOf(r2); return; }
                            throw driveError(r2, "upload " + p);
                        });
                    }).catch(function (e) {
                        return N.send(ctx, { method: "DELETE", url: session }).catch(function () {}).then(function () { throw e; });
                    });
                }).then(function () {
                    delete meta[p];
                    return done ? entryOf(done, p) : drive.stat(p);
                });
            });
        },

        mkdir: function (p) {
            var parent = p.replace(/\/[^/]*$/, "") || "/", name = p.slice(p.lastIndexOf("/") + 1);
            return Promise.all([resolve(parent), exists(p)]).then(function (r) {
                if (r[1]) throw kit.fileError(E.EXISTS, "Already exists: " + p);
                return json("POST", api + "/files?fields=" + encodeURIComponent(FIELDS), { name: name, mimeType: FOLDER, parents: [r[0].id] });
            }).then(function (m) { return entryOf(m, p); });
        },

        move: function (from, to, o) {
            var parent = to.replace(/\/[^/]*$/, "") || "/", name = to.slice(to.lastIndexOf("/") + 1);
            return Promise.all([resolve(from), resolve(parent), exists(to)]).then(function (r) {
                var m = r[0];
                var clear = r[2] ? (o.overwrite ? trash(meta[to].id) : Promise.reject(kit.fileError(E.EXISTS, "Already exists: " + to))) : Promise.resolve();
                return clear.then(function () {
                    var url = api + "/files/" + encodeURIComponent(m.id) + "?fields=" + encodeURIComponent(FIELDS) +
                        "&addParents=" + encodeURIComponent(r[1].id) + "&removeParents=" + encodeURIComponent((m.parents || []).join(","));
                    return json("PATCH", url, { name: name });
                });
            }).then(function () { delete meta[from]; delete meta[to]; });
        },

        copy: function (from, to, o) {
            var parent = to.replace(/\/[^/]*$/, "") || "/", name = to.slice(to.lastIndexOf("/") + 1);
            return Promise.all([resolve(from), resolve(parent), exists(to)]).then(function (r) {
                if (r[0].mimeType === FOLDER) throw kit.fileError(E.UNSUPPORTED, "Google Drive copies files, not folders");
                var clear = r[2] ? (o.overwrite ? trash(meta[to].id) : Promise.reject(kit.fileError(E.EXISTS, "Already exists: " + to))) : Promise.resolve();
                return clear.then(function () {
                    return json("POST", api + "/files/" + encodeURIComponent(r[0].id) + "/copy?fields=" + encodeURIComponent(FIELDS), { name: name, parents: [r[1].id] });
                });
            }).then(function () { delete meta[to]; });
        },

        remove: function (p) { return resolve(p).then(function (m) { return trash(m.id); }).then(function () { delete meta[p]; }); },

        search: function (query, so) {
            var words = String(query).split(/\s+/).filter(Boolean);
            var cond = words.map(function (w) { return "name contains " + q(w); }).join(" and ") + " and trashed = false";
            var url = api + "/files?q=" + encodeURIComponent(cond) + "&fields=" + encodeURIComponent("files(" + FIELDS + ")") + "&pageSize=" + so.limit + "&spaces=drive";
            return json("GET", url).then(function (r) {
                // Each result's path, from its parents (asked once per folder).
                var byId = {};
                function pathOfId(id) {
                    if (byId[id]) return byId[id];
                    byId[id] = json("GET", api + "/files/" + encodeURIComponent(id) + "?fields=" + encodeURIComponent(FIELDS)).then(function (m) {
                        if (!m.parents || !m.parents.length) return "";
                        return pathOfId(m.parents[0]).then(function (pp) { return pp === null ? null : pp + "/" + shownName(m); });
                    }, function () { return null; });
                    return byId[id];
                }
                return json("GET", api + "/files/root?fields=id").then(function (root) {
                    byId[root.id] = Promise.resolve("");
                    return Promise.all((r.files || []).map(function (m) {
                        var parent = m.parents && m.parents[0];
                        return (parent ? pathOfId(parent) : Promise.resolve(null)).then(function (pp) {
                            if (pp === null) return null;
                            var path = pp + "/" + shownName(m);
                            if (so.path !== "/" && path.indexOf(so.path + "/") !== 0) return null;
                            return entryOf(m, path);
                        });
                    }));
                }).then(function (list) { return list.filter(Boolean); });
            });
        },

        quota: function () {
            return json("GET", api + "/about?fields=storageQuota").then(function (a) {
                var s = a.storageQuota || {};
                return s.limit ? { used: Number(s.usage) || 0, total: Number(s.limit) } : { used: Number(s.usage) || 0 };
            });
        }
    };

    function trash(id) { return json("PATCH", api + "/files/" + encodeURIComponent(id), { trashed: true }); }

    return drive;
}

function whoAmI(ctx, token, api) {
    return N.send(ctx, { method: "GET", url: (api || API) + "/about?fields=user", headers: { Authorization: "Bearer " + token, Accept: "application/json" } })
        .then(function (res) {
            if (res.status !== 200) throw driveError(res, "about");
            var u = (N.jsonOf(res) || {}).user || {};
            return { username: u.emailAddress || u.displayName || u.permissionId, id: u.permissionId };
        });
}

module.exports = { createGdrive: createGdrive, whoAmI: whoAmI,
                   OAUTH: { authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth", tokenEndpoint: "https://oauth2.googleapis.com/token",
                            revocationEndpoint: "https://oauth2.googleapis.com/revoke",
                            scope: "https://www.googleapis.com/auth/drive.file",
                            fullScope: "https://www.googleapis.com/auth/drive",
                            params: { access_type: "offline", prompt: "consent" } },
                   HOSTS: ["www.googleapis.com"] };
