// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dropbox as a drive: its HTTP API v2 (https://www.dropbox.com/developers/documentation/http/documentation),
// signed in with OAuth 2 and PKCE as a public client (no secret on the
// device), offline access for a refresh token. Phoenix's app must be
// registered in the Dropbox App Console (docs/DEVELOPER-APPS.md).
//
//   list      files/list_folder (+ /continue)
//   stat      files/get_metadata
//   download  content: files/download, Dropbox-API-Arg, with Range
//   upload    files/upload up to a chunk; larger in an upload session
//             (upload_session/start, append_v2, finish)
//   mkdir     files/create_folder_v2; move, copy: files/move_v2, copy_v2
//   remove    files/delete_v2
//   search    files/search_v2
//   quota     users/get_space_usage

"use strict";

var kit = require("@phoenix/connector-kit");
var N = require("./net");

var E = kit.FILE_ERRORS;
var API = "https://api.dropboxapi.com/2/";
var CONTENT = "https://content.dropboxapi.com/2/";

// Dropbox-API-Arg must be "HTTP header safe": non-ASCII as \uXXXX.
function headerJson(v) {
    return JSON.stringify(v).replace(/[\u007f-￿]/g, function (c) { return "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4); });
}

// A 409's error_summary ("path/not_found/..") -> the file manager's error.
function apiError(res, what) {
    var body = N.jsonOf(res) || {};
    var summary = String(body.error_summary || "");
    if (res.status === 409) {
        if (/not_found/.test(summary)) return kit.fileError(E.NOT_FOUND, what + ": not found");
        if (/conflict/.test(summary)) return kit.fileError(E.EXISTS, what + ": already exists");
        if (/insufficient_space/.test(summary)) return kit.fileError(E.QUOTA, what + ": your Dropbox is full");
        if (/no_write_permission|cant_/.test(summary)) return kit.fileError(E.PERMISSION, what + ": not allowed (" + summary + ")");
        if (/not_folder/.test(summary)) return kit.fileError(E.NOT_DIR, what + ": not a folder");
        if (/not_file/.test(summary)) return kit.fileError(E.IS_DIR, what + ": a folder");
    }
    return kit.httpError(res.status, what, summary || (body.error && body.error[".tag"]) || "");
}

/** opts: {token() -> Promise<access token>, api?, content? (base addresses: the tests' server)}. */
function createDropbox(ctx, opts) {
    var api = opts.api || API, content = opts.content || CONTENT;
    var dbx = function (p) { return p === "/" ? "" : p; };

    function rpc(name, args, ok) {
        return opts.token().then(function (t) {
            return N.send(ctx, { method: "POST", url: api + name, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
                                 body: JSON.stringify(args === undefined ? null : args) });
        }).then(function (res) {
            if ((ok || [200]).indexOf(res.status) < 0) throw apiError(res, name);
            return N.jsonOf(res);
        });
    }
    function contentCall(name, args, body, headers, binary) {
        return opts.token().then(function (t) {
            var h = Object.assign({ Authorization: "Bearer " + t, "Dropbox-API-Arg": headerJson(args) }, headers || {});
            if (body !== undefined) h["Content-Type"] = "application/octet-stream";
            var r = { method: "POST", url: content + name, headers: h, binary: !!binary };
            if (body !== undefined) r.body = body;
            return N.send(ctx, r);
        });
    }

    function entryOf(m) {
        var dir = m[".tag"] === "folder";
        var e = { name: m.name, path: m.path_display || ("/" + m.name), type: dir ? "directory" : "file", size: dir ? 0 : Number(m.size) || 0,
                  mtime: Date.parse(m.server_modified || m.client_modified || "") || 0, id: m.id };
        if (m.rev) e.etag = m.rev;
        if (m.content_hash) e.etag = m.content_hash;
        return e;
    }

    var drive = {
        list: function (p) {
            var out = [];
            function page(r) {
                (r.entries || []).forEach(function (m) { if (m[".tag"] !== "deleted") out.push(entryOf(m)); });
                if (r.has_more) return rpc("files/list_folder/continue", { cursor: r.cursor }).then(page);
                return out;
            }
            return rpc("files/list_folder", { path: dbx(p), limit: 2000 }).then(page);
        },

        stat: function (p) {
            if (p === "/") return rpc("files/list_folder", { path: "", limit: 1 }).then(function () { return { name: "", path: "/", type: "directory", size: 0, mtime: 0 }; });
            return rpc("files/get_metadata", { path: p }).then(entryOf);
        },

        download: function (entry, sink, o) {
            return kit.downloadInRanges(entry.size, sink, o, function (start, end) {
                return contentCall("files/download", { path: entry.path }, undefined, end >= 0 ? { Range: "bytes=" + start + "-" + end } : {}, true)
                    .then(function (res) {
                        if (res.status !== 200 && res.status !== 206) throw apiError(res, "download " + entry.path);
                        return res;
                    });
            }, "download " + entry.path);
        },

        upload: function (p, source, o) {
            var commit = { path: p, mode: o.overwrite ? "overwrite" : "add", autorename: false, mute: true };
            if (source.size <= o.chunkSize) {
                o.onProgress(0, source.size);
                return source.read(0, source.size).then(function (bytes) {
                    if (o.signal.aborted) throw kit.fileError(E.CANCELED, "Cancelled");
                    return contentCall("files/upload", commit, bytes);
                }).then(function (res) {
                    if (res.status !== 200) throw apiError(res, "upload " + p);
                    o.onProgress(source.size, source.size);
                    return entryOf(Object.assign({ ".tag": "file" }, N.jsonOf(res)));
                });
            }
            // An upload session: the chunks (a multiple of 4 MB, as Dropbox asks), then finish.
            var chunk = Math.max(4194304, Math.floor(o.chunkSize / 4194304) * 4194304);
            var session = null, done = null;
            return kit.forEachChunk(source, Object.assign({}, o, { chunkSize: chunk }), function (bytes, offset, last) {
                var call;
                if (!session) call = contentCall("files/upload_session/start", { close: false }, bytes);
                else if (!last) call = contentCall("files/upload_session/append_v2", { cursor: { session_id: session, offset: offset }, close: false }, bytes);
                else call = contentCall("files/upload_session/finish", { cursor: { session_id: session, offset: offset }, commit: commit }, bytes);
                return call.then(function (res) {
                    if (res.status !== 200) throw apiError(res, "upload " + p);
                    var body = N.jsonOf(res) || {};
                    if (!session) {
                        session = body.session_id;
                        if (last) {
                            // One chunk only (the file is exactly a chunk): finish with nothing more.
                            return contentCall("files/upload_session/finish", { cursor: { session_id: session, offset: bytes.length }, commit: commit },
                                               new Uint8Array(0)).then(function (r2) {
                                if (r2.status !== 200) throw apiError(r2, "upload " + p);
                                done = N.jsonOf(r2);
                            });
                        }
                    } else if (last) done = body;
                });
            }).then(function () { return entryOf(Object.assign({ ".tag": "file" }, done || {})); });
        },

        mkdir: function (p) {
            return rpc("files/create_folder_v2", { path: p, autorename: false }).then(function (r) { return entryOf(r.metadata); });
        },

        move: function (from, to, o) { return moveOrCopy("files/move_v2", from, to, o); },
        copy: function (from, to, o) { return moveOrCopy("files/copy_v2", from, to, o); },

        remove: function (p) { return rpc("files/delete_v2", { path: p }).then(function () {}); },

        search: function (query, so) {
            var opts2 = { max_results: Math.min(so.limit, 1000), file_status: "active" };
            if (so.path !== "/") opts2.path = so.path;
            return rpc("files/search_v2", { query: query, options: opts2 }).then(function (r) {
                return (r.matches || []).map(function (m) { return m.metadata && m.metadata.metadata; }).filter(Boolean).map(entryOf);
            });
        },

        quota: function () {
            return rpc("users/get_space_usage", null).then(function (r) {
                var a = r.allocation || {};
                var total = a.allocated !== undefined ? a.allocated : undefined;
                return total === undefined ? { used: Number(r.used) || 0 } : { used: Number(r.used) || 0, total: Number(total) };
            });
        }
    };

    function moveOrCopy(name, from, to, o) {
        var go = function () { return rpc(name, { from_path: from, to_path: to, autorename: false }); };
        return go().catch(function (e) {
            if (e.code !== E.EXISTS || !o.overwrite) throw e;
            return rpc("files/delete_v2", { path: to }).then(go);
        }).then(function () {});
    }

    return drive;
}

/** The account's e-mail, for its name in Accounts. */
function whoAmI(ctx, token, api) {
    return N.send(ctx, { method: "POST", url: (api || API) + "users/get_current_account", headers: { Authorization: "Bearer " + token } })
        .then(function (res) {
            if (res.status !== 200) throw apiError(res, "users/get_current_account");
            var b = N.jsonOf(res) || {};
            return { username: b.email || (b.name && b.name.display_name) || b.account_id, id: b.account_id };
        });
}

module.exports = { createDropbox: createDropbox, whoAmI: whoAmI, headerJson: headerJson,
                   OAUTH: { authorizationEndpoint: "https://www.dropbox.com/oauth2/authorize", tokenEndpoint: "https://api.dropboxapi.com/oauth2/token",
                            scope: "account_info.read files.metadata.read files.content.read files.content.write",
                            params: { token_access_type: "offline" } },
                   HOSTS: ["api.dropboxapi.com", "content.dropboxapi.com"] };
