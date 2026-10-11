// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Box as a drive: its Content API (https://developer.box.com/reference/),
// with Box's OAuth 2 (docs/DEVELOPER-APPS.md: a Custom App with user
// authentication; Box dropped WebDAV). Like Google Drive, Box is a graph of
// ids: a path is found name by name from the folder "0" (All Files).
//
//   list      GET /folders/{id}/items (marker paging)
//   download  GET /files/{id}/content -> 302 to a download address, with Range
//   upload    POST upload.box.com/api/2.0/files/content (multipart form) for a
//             new file, /files/{id}/content for a new version; from 20 MB
//             a chunked upload session (POST /files/upload_sessions, PUT
//             parts of the session's part_size with Digest: sha=<SHA-1>, POST
//             commit with the whole file's SHA-1)
//   mkdir     POST /folders; move: PUT /files|folders/{id} {name, parent}
//   copy      POST /files|folders/{id}/copy
//   remove    DELETE /files/{id}, /folders/{id}?recursive=true (to Box's trash)
//   search    GET /search?query=&ancestor_folder_ids=
//   quota     GET /users/me?fields=space_amount,space_used

"use strict";

var kit = require("@phoenix/connector-kit");
var H = require("./hash");
var N = require("./net");

var E = kit.FILE_ERRORS;
var API = "https://api.box.com/2.0";
var UPLOAD = "https://upload.box.com/api/2.0";
var FIELDS = "id,type,name,size,modified_at,etag,sha1,permissions,path_collection";
var CHUNKED_FROM = 20 * 1024 * 1024;

function boxError(res, what) {
    var b = N.jsonOf(res) || {};
    var code = String(b.code || "");
    if (res.status === 409 || code === "item_name_in_use") return kit.fileError(E.EXISTS, what + ": already exists");
    if (code === "storage_limit_exceeded" || code === "insufficient_storage") return kit.fileError(E.QUOTA, what + ": your Box is full");
    if (code === "file_size_limit_exceeded") return kit.fileError(E.TOO_LARGE, what + ": larger than your Box plan allows");
    return kit.httpError(res.status, what, code || b.message || "");
}

/** opts: {token(), api?, upload? (the tests' server)}. */
function createBox(ctx, opts) {
    var api = opts.api || API, up = opts.upload || UPLOAD;
    var meta = { "/": { id: "0", type: "folder", name: "" } };

    function call(method, url, body, ok, headers, extra) {
        return opts.token().then(function (t) {
            var h = Object.assign({ Authorization: "Bearer " + t, Accept: "application/json" }, headers || {});
            var r = { method: method, url: url, headers: h };
            if (body !== undefined) {
                if (body instanceof Uint8Array || typeof body === "string") r.body = body;
                else { r.body = JSON.stringify(body); h["Content-Type"] = "application/json"; }
            }
            Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
            return N.send(ctx, r);
        }).then(function (res) {
            if ((ok || [200]).indexOf(res.status) < 0) throw boxError(res, method + " " + url.replace(/^https?:\/\/[^/]+(\/api)?\/2\.0/, "").replace(/\?.*$/, ""));
            return res;
        });
    }
    function json(method, url, body, ok, headers) { return call(method, url, body, ok, headers).then(function (r) { return N.jsonOf(r) || {}; }); }
    var kindOf = function (m) { return m.type === "folder" ? "folders" : "files"; };

    function entryOf(m, path) {
        var dir = m.type === "folder";
        var e = { name: path === "/" ? "" : m.name, path: path, type: dir ? "directory" : "file", size: dir ? 0 : Number(m.size) || 0,
                  mtime: Date.parse(m.modified_at || "") || 0, id: m.id };
        if (m.sha1 || m.etag) e.etag = m.sha1 || String(m.etag);
        if (m.permissions && m.permissions.can_upload === false && dir) e.readOnly = true;
        meta[path] = m;
        return e;
    }

    function items(id) {
        var out = [];
        function page(marker) {
            var url = api + "/folders/" + encodeURIComponent(id) + "/items?fields=" + encodeURIComponent(FIELDS) + "&limit=1000&usemarker=true" +
                (marker ? "&marker=" + encodeURIComponent(marker) : "");
            return json("GET", url).then(function (r) {
                out = out.concat((r.entries || []).filter(function (m) { return m.type === "file" || m.type === "folder"; }));
                return r.next_marker ? page(r.next_marker) : out;
            });
        }
        return page(null);
    }

    function resolve(p) {
        if (meta[p]) return Promise.resolve(meta[p]);
        var parent = p.replace(/\/[^/]*$/, "") || "/";
        return resolve(parent).then(function (pm) {
            if (pm.type !== "folder") throw kit.fileError(E.NOT_DIR, "Not a folder: " + parent);
            return items(pm.id);
        }).then(function (list) {
            list.forEach(function (m) { var cp = (parent === "/" ? "" : parent) + "/" + m.name; if (!meta[cp]) meta[cp] = m; });
            if (!meta[p]) throw kit.fileError(E.NOT_FOUND, "No such file or folder: " + p);
            return meta[p];
        });
    }
    function exists(p) { return resolve(p).then(function () { return true; }, function (e) { if (e.code === E.NOT_FOUND) return false; throw e; }); }

    function form(attributes, name, bytes, type) {
        var b = "phoenix" + N.randomId();
        return { type: "multipart/form-data; boundary=" + b,
                 body: N.concat(["--" + b + "\r\nContent-Disposition: form-data; name=\"attributes\"\r\n\r\n" + JSON.stringify(attributes) + "\r\n--" + b +
                                 "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + encodeURIComponent(name) + "\"\r\nContent-Type: " + type + "\r\n\r\n",
                                 bytes, "\r\n--" + b + "--\r\n"]) };
    }

    var drive = {
        list: function (p) {
            return resolve(p).then(function (m) {
                if (m.type !== "folder") throw kit.fileError(E.NOT_DIR, "Not a folder: " + p);
                return items(m.id);
            }).then(function (list) { return list.map(function (m) { return entryOf(m, (p === "/" ? "" : p) + "/" + m.name); }); });
        },

        stat: function (p) {
            return resolve(p).then(function (m) {
                return json("GET", api + "/" + kindOf(m) + "/" + encodeURIComponent(m.id) + "?fields=" + encodeURIComponent(FIELDS));
            }).then(function (m) { return entryOf(m, p); });
        },

        download: function (entry, sink, o) {
            return resolve(entry.path).then(function (m) {
                // The content answers with a redirect to a download address (no token goes there).
                return call("GET", api + "/files/" + encodeURIComponent(m.id) + "/content", undefined, [302, 200], {}, { binary: true });
            }).then(function (res) {
                if (res.status === 200) {
                    o.onProgress(0, entry.size);
                    return sink.write(res.bytes || new Uint8Array(0)).then(function () { o.onProgress(entry.size, entry.size); });
                }
                var u = new URL(res.headers.location, api).href;
                ctx.http.allowHost(new URL(u).host);
                return kit.downloadInRanges(entry.size, sink, o, function (start, end) {
                    return N.send(ctx, { method: "GET", url: u, headers: end >= 0 ? { Range: "bytes=" + start + "-" + end } : {}, binary: true });
                }, "download " + entry.path);
            });
        },

        upload: function (p, source, o) {
            var parent = p.replace(/\/[^/]*$/, "") || "/", name = p.slice(p.lastIndexOf("/") + 1);
            var type = source.mimeType || "application/octet-stream";
            return Promise.all([resolve(parent), exists(p)]).then(function (r) {
                var pm = r[0], there = r[1] ? meta[p] : null;
                if (pm.type !== "folder") throw kit.fileError(E.NOT_DIR, "Not a folder: " + parent);
                if (there && !o.overwrite) throw kit.fileError(E.EXISTS, "Already exists: " + p);
                if (there && there.type === "folder") throw kit.fileError(E.IS_DIR, "A folder has this name: " + p);
                var done;
                if (source.size < CHUNKED_FROM) {
                    o.onProgress(0, source.size);
                    done = source.read(0, source.size).then(function (bytes) {
                        if (o.signal.aborted) throw kit.fileError(E.CANCELED, "Cancelled");
                        var f = form(there ? { name: name } : { name: name, parent: { id: pm.id } }, name, bytes, type);
                        var url = up + "/files" + (there ? "/" + encodeURIComponent(there.id) : "") + "/content?fields=" + encodeURIComponent(FIELDS);
                        return json("POST", url, f.body, [201, 200], { "Content-Type": f.type });
                    }).then(function (res) {
                        o.onProgress(source.size, source.size);
                        return (res.entries || [])[0];
                    });
                } else {
                    done = chunked(there, pm, name, source, o);
                }
                return done.then(function (m) { delete meta[p]; return m ? entryOf(m, p) : drive.stat(p); });
            });
        },

        mkdir: function (p) {
            var parent = p.replace(/\/[^/]*$/, "") || "/", name = p.slice(p.lastIndexOf("/") + 1);
            return resolve(parent).then(function (pm) {
                return json("POST", api + "/folders?fields=" + encodeURIComponent(FIELDS), { name: name, parent: { id: pm.id } }, [201]);
            }).then(function (m) { return entryOf(m, p); });
        },

        move: function (from, to, o) { return place("PUT", from, to, o); },
        copy: function (from, to, o) { return place("POST", from, to, o); },

        remove: function (p) {
            return resolve(p).then(function (m) {
                return call("DELETE", api + "/" + kindOf(m) + "/" + encodeURIComponent(m.id) + (m.type === "folder" ? "?recursive=true" : ""), undefined, [204]);
            }).then(function () { delete meta[p]; });
        },

        search: function (query, so) {
            return resolve(so.path).then(function (root) {
                var url = api + "/search?query=" + encodeURIComponent(query) + "&limit=" + Math.min(so.limit, 200) + "&ancestor_folder_ids=" +
                    encodeURIComponent(root.id) + "&fields=" + encodeURIComponent(FIELDS);
                return json("GET", url);
            }).then(function (r) {
                return (r.entries || []).filter(function (m) { return m.type === "file" || m.type === "folder"; }).map(function (m) {
                    var names = ((m.path_collection && m.path_collection.entries) || []).filter(function (x) { return x.id !== "0"; })
                        .map(function (x) { return x.name; });
                    return entryOf(m, "/" + names.concat([m.name]).join("/"));
                });
            });
        },

        quota: function () {
            return json("GET", api + "/users/me?fields=space_amount,space_used").then(function (u) {
                // Box says 999999999999999 for "unlimited".
                var total = Number(u.space_amount);
                return total > 0 && total < 9e14 ? { used: Number(u.space_used) || 0, total: total } : { used: Number(u.space_used) || 0 };
            });
        }
    };

    function place(method, from, to, o) {
        var parent = to.replace(/\/[^/]*$/, "") || "/", name = to.slice(to.lastIndexOf("/") + 1);
        return Promise.all([resolve(from), resolve(parent), exists(to)]).then(function (r) {
            var m = r[0];
            var clear = !r[2] ? Promise.resolve() : !o.overwrite ? Promise.reject(kit.fileError(E.EXISTS, "Already exists: " + to)) : drive.remove(to);
            return clear.then(function () {
                var url = api + "/" + kindOf(m) + "/" + encodeURIComponent(m.id) + (method === "POST" ? "/copy" : "") + "?fields=" + encodeURIComponent(FIELDS);
                return json(method, url, { name: name, parent: { id: r[1].id } }, method === "POST" ? [201] : [200]);
            });
        }).then(function () { delete meta[from]; delete meta[to]; });
    }

    // Box's chunked upload: parts of the session's size, each with its SHA-1,
    // then a commit with the whole file's.
    function chunked(there, pm, name, source, o) {
        var whole = H.createSha1(), session = null, parts = [];
        var start = there
            ? json("POST", up + "/files/" + encodeURIComponent(there.id) + "/upload_sessions", { file_size: source.size, file_name: name }, [201])
            : json("POST", up + "/files/upload_sessions", { folder_id: pm.id, file_size: source.size, file_name: name }, [201]);
        return start.then(function (s) {
            session = s;
            if (!s.id || !s.part_size) throw kit.fileError(E.IO, "Box gave no upload session");
            return kit.forEachChunk(source, Object.assign({}, o, { chunkSize: s.part_size }), function (bytes, offset) {
                whole.update(bytes);
                return call("PUT", up + "/files/upload_sessions/" + encodeURIComponent(s.id), bytes, [200], {
                    "Content-Type": "application/octet-stream", Digest: "sha=" + H.base64(H.sha1(bytes)),
                    "Content-Range": "bytes " + offset + "-" + (offset + bytes.length - 1) + "/" + source.size
                }).then(function (res) { parts.push((N.jsonOf(res) || {}).part); });
            });
        }).then(function () {
            return json("POST", up + "/files/upload_sessions/" + encodeURIComponent(session.id) + "/commit?fields=" + encodeURIComponent(FIELDS),
                        { parts: parts }, [201], { Digest: "sha=" + H.base64(whole.digest()) });
        }).then(function (r) { return (r.entries || [])[0]; }).catch(function (e) {
            if (!session) throw e;
            return call("DELETE", up + "/files/upload_sessions/" + encodeURIComponent(session.id), undefined, [204]).catch(function () {})
                .then(function () { throw e; });
        });
    }

    return drive;
}

function whoAmI(ctx, token, api) {
    return N.send(ctx, { method: "GET", url: (api || API) + "/users/me?fields=login,name,id", headers: { Authorization: "Bearer " + token, Accept: "application/json" } })
        .then(function (res) {
            if (res.status !== 200) throw boxError(res, "users/me");
            var u = N.jsonOf(res) || {};
            return { username: u.login || u.name || u.id, id: u.id };
        });
}

module.exports = { createBox: createBox, whoAmI: whoAmI,
                   OAUTH: { authorizationEndpoint: "https://account.box.com/api/oauth2/authorize", tokenEndpoint: "https://api.box.com/oauth2/token",
                            revocationEndpoint: "https://api.box.com/oauth2/revoke", scope: "root_readwrite" },
                   HOSTS: ["api.box.com", "upload.box.com", "dl.boxcloud.com", "*.boxcloud.com"] };
