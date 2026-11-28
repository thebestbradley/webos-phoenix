// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Google Drive as a drive: the Drive API v3
// (https://developers.google.com/drive/api/reference/rest/v3), signed in
// with Google's OAuth 2 for installed apps (PKCE; Google's "desktop app"
// client has a secret that is not secret, docs/DEVELOPER-APPS.md).
//
// The person chooses what Phoenix may see when adding the account (the
// owner, 27 November 2026), and the account keeps it (its access):
//
//   "drive.file"  Files you open with Phoenix: the files Phoenix made and
//                 those the person picked for it in Google's Picker, nothing
//                 else (https://www.googleapis.com/auth/drive.file;
//                 non-sensitive: no security assessment). Google grants it
//                 file by file, for what Phoenix uploads and what the Picker
//                 returns. A picked file's folder is not Phoenix's to see, so
//                 such files (and folders) are at the top of the drive here;
//                 a folder Phoenix may see shows only the files in it Phoenix
//                 may see (files.list answers only those). The sign-in shows
//                 the Picker (Google's flow for desktop and mobile apps:
//                 trigger_onepick on the authorization request,
//                 https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker),
//                 and signing in again picks more.
//   "drive"       All your Drive (https://www.googleapis.com/auth/drive):
//                 restricted, so Google must verify Phoenix and a yearly
//                 security assessment must pass before more than its test
//                 users can sign in (SYNERGY-MODERN.md 3.3, OPEN-QUESTIONS
//                 Q77); the registration says when that is done
//                 (clients.json googledrive.scope = "drive").
//
// Drive is a graph of ids, not paths: a path is found name by name from
// "root" (one listing per folder, kept for the rest of the call). A folder
// may hold two of a name (and with drive.file, files picked from two
// folders meet at the top): the second is "name (2).ext" here (named). A
// shortcut is what it points to. With all your Drive, what others shared
// with the person is under "Shared with me" (sharedWithMe; such files have
// no parents the person sees). Google's own documents (Docs, Sheets,
// Slides) are downloaded as .docx, .xlsx, .pptx (files.export, up to 10 MB)
// and are read only here; Forms, Sites and the like have nothing to
// download: their entry has webUrl, their page, which Files opens in the
// browser. A 401 before the token's time is up here is answered with a new
// token and the request again; a part of a transfer has the time its bytes
// need on a slow network (transferBytes).
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
var SHORTCUT = "application/vnd.google-apps.shortcut";
var FIELDS = "id,name,mimeType,size,modifiedTime,md5Checksum,version,parents,capabilities(canEdit),webViewLink,sharedWithMe," +
             "shortcutDetails(targetId,targetMimeType)";
var EXPORTS = {
    "application/vnd.google-apps.document": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
    "application/vnd.google-apps.spreadsheet": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
    "application/vnd.google-apps.presentation": ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
    "application/vnd.google-apps.drawing": ["image/png", ".png"]
};
// Google's own kinds with no file to download or export (Forms, Sites, My
// Maps, ...): they open in the browser (webViewLink).
var WEB_ONLY = { "application/vnd.google-apps.form": "Google Form", "application/vnd.google-apps.site": "Google Site",
                 "application/vnd.google-apps.map": "Google My Map", "application/vnd.google-apps.jam": "Jamboard",
                 "application/vnd.google-apps.script": "Apps Script project", "application/vnd.google-apps.fusiontable": "Fusion Table" };
// Google exports a document up to 10 MB (files.export).
var EXPORT_LIMIT = 10 * 1024 * 1024;
var RESUMABLE_PART = 262144;
// With all your Drive: what others shared with the person, as Drive's own
// pages have it (sharedWithMe; such files have no parents the person sees).
var SHARED_ID = "phoenix:sharedWithMe", SHARED_NAME = "Shared with me";

function q(s) { return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }
function isGoogleKind(mime) { return /^application\/vnd\.google-apps\./.test(mime || "") && mime !== FOLDER; }
function webOnly(m) { return isGoogleKind(m.mimeType) && !EXPORTS[m.mimeType]; }

function driveError(res, what) {
    var b = N.jsonOf(res) || {};
    var reason = String((b.error && b.error.errors && b.error.errors[0] && b.error.errors[0].reason) || (b.error && b.error.status) || "");
    if (/storageQuotaExceeded|quotaExceeded/.test(reason)) return kit.fileError(E.QUOTA, what + ": your Google Drive is full");
    if (reason === "exportSizeLimitExceeded")
        return kit.fileError(E.TOO_LARGE, what + ": too large for Google to export (over 10 MB). Open it in Google Drive in the browser instead");
    if (reason === "fileNotDownloadable") return kit.fileError(E.UNSUPPORTED, what + ": Google has no file to download for it. Open it in Google Drive in the browser instead");
    if (res.status === 404 || reason === "notFound") return kit.fileError(E.NOT_FOUND, what + ": not found");
    if (/rateLimitExceeded|userRateLimitExceeded/.test(reason)) return kit.httpError(429, what, reason);
    return kit.httpError(res.status, what, reason || (b.error && b.error.message) || "");
}

// A shortcut is what it points to (its own id kept: removing or moving it
// is the shortcut's; reading is the target's).
function real(m) {
    if (!m || m.mimeType !== SHORTCUT || !m.shortcutDetails || !m.shortcutDetails.targetId) return m;
    return Object.assign({}, m, { mimeType: m.shortcutDetails.targetMimeType || "application/octet-stream", target: m.shortcutDetails.targetId,
                                  size: undefined, md5Checksum: undefined });
}
function contentId(m) { return m.target || m.id; }

// The name a file shows under (Google's documents: with the extension they download as).
function shownName(m) { var x = EXPORTS[m.mimeType]; return x && !/\.\w+$/.test(m.name) ? m.name + x[1] : m.name; }

// A folder's entries with their names. Drive allows two of a name in a
// folder (and with drive.file, files picked from two folders meet at the
// top): the first (by id, so the same on every listing) keeps the name, the
// others get " (2)", " (3)", ... before the extension, a name not taken.
function named(list) {
    var order = list.slice().sort(function (a, b) {
        return (a.virtual ? 1 : 0) - (b.virtual ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    var taken = {}, out = [], again = [];
    order.forEach(function (m) {
        var n = shownName(m);
        if (taken[n]) again.push(m);
        else { taken[n] = true; out.push({ m: m, name: n }); }
    });
    again.forEach(function (m) {
        var n = shownName(m), dot = m.mimeType === FOLDER ? -1 : n.lastIndexOf(".");
        var base = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : "", k = 2;
        while (taken[base + " (" + k + ")" + ext]) k++;
        var name = base + " (" + k + ")" + ext;
        taken[name] = true;
        out.push({ m: m, name: name });
    });
    return out;
}

/** opts: {token(o?: {refresh}), access? ("drive.file", the default, or "drive"), api?, upload? (the tests' server)}. */
function createGdrive(ctx, opts) {
    var api = opts.api || API, upload = opts.upload || UPLOAD;
    var perFile = opts.access !== "drive";
    var sharedFolder = { id: SHARED_ID, name: SHARED_NAME, mimeType: FOLDER, virtual: true, capabilities: { canEdit: false } };

    // A request with the account's token. A 401 before the token's time is
    // up here (a clock that differs, a token Google ended early): a new one,
    // and the request once more. build(token) -> the request.
    function authed(build) {
        return opts.token().then(function (t) { return N.send(ctx, build(t)); }).then(function (res) {
            if (res.status !== 401) return res;
            return opts.token({ refresh: true }).then(function (t) { return N.send(ctx, build(t)); });
        });
    }

    function call(method, url, body, ok, headers, transferBytes) {
        return authed(function (t) {
            var h = Object.assign({ Authorization: "Bearer " + t, Accept: "application/json" }, headers || {});
            var r = { method: method, url: url, headers: h };
            if (transferBytes) r.transferBytes = transferBytes;
            if (body !== undefined) {
                if (body instanceof Uint8Array || typeof body === "string") r.body = body;
                else { r.body = JSON.stringify(body); h["Content-Type"] = "application/json; charset=UTF-8"; }
            }
            return r;
        }).then(function (res) {
            if ((ok || [200]).indexOf(res.status) < 0) throw driveError(res, method + " " + url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, ""));
            return res;
        });
    }
    function json(method, url, body, ok) { return call(method, url, body, ok).then(function (r) { return N.jsonOf(r) || {}; }); }

    function listAll(cond) {
        var out = [];
        function page(token) {
            var url = api + "/files?q=" + encodeURIComponent(cond) +
                "&fields=" + encodeURIComponent("nextPageToken,files(" + FIELDS + ")") + "&pageSize=1000&spaces=drive" +
                (token ? "&pageToken=" + encodeURIComponent(token) : "");
            return json("GET", url).then(function (r) {
                out = out.concat((r.files || []).map(real));
                return r.nextPageToken ? page(r.nextPageToken) : out;
            });
        }
        return page(null);
    }

    // drive.file: the top of the drive is every file Phoenix may see whose
    // folder it may not (one picked from a folder of the person's, one shared
    // with them), and those in My Drive itself.
    function topLevel() {
        return listAll("trashed = false").then(function (all) {
            var seen = {};
            all.forEach(function (m) { seen[m.id] = true; });
            return all.filter(function (m) { return !m.parents || !m.parents.length || !seen[m.parents[0]]; });
        });
    }

    function children(id) {
        if (perFile && id === "root") return topLevel();
        if (id === SHARED_ID) return listAll("sharedWithMe = true and trashed = false");
        return listAll(q(id) + " in parents and trashed = false").then(function (list) {
            return !perFile && id === "root" ? list.concat([sharedFolder]) : list;
        });
    }
    // A folder's entries by name (named), asked once per folder in a call.
    var listed = {};
    function namesIn(id) {
        if (!listed[id]) listed[id] = children(id).then(named);
        return listed[id];
    }

    function entryOf(m, path) {
        var dir = m.mimeType === FOLDER;
        var e = { name: path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1), path: path, type: dir ? "directory" : "file",
                  size: dir ? 0 : Number(m.size) || 0, mtime: Date.parse(m.modifiedTime || "") || 0, id: m.id };
        if (m.md5Checksum || m.version) e.etag = m.md5Checksum || String(m.version);
        if (!dir) e.mimeType = EXPORTS[m.mimeType] ? EXPORTS[m.mimeType][0] : m.mimeType;
        if (isGoogleKind(m.mimeType) || m.virtual || (m.capabilities && m.capabilities.canEdit === false)) e.readOnly = true;
        // Google's kinds with nothing to download: the page to open in the browser.
        if (webOnly(m) && m.webViewLink) e.webUrl = m.webViewLink;
        meta[path] = m;
        return e;
    }
    var meta = {};

    // The metadata of a path, name by name from the root.
    function resolve(p) {
        if (meta[p]) return Promise.resolve(meta[p]);
        // drive.file: My Drive's own metadata is not Phoenix's to read; "root" names it.
        if (p === "/" && perFile) { meta["/"] = { id: "root", name: "", mimeType: FOLDER }; return Promise.resolve(meta["/"]); }
        if (p === "/") return json("GET", api + "/files/root?fields=" + encodeURIComponent(FIELDS)).then(function (m) { meta["/"] = Object.assign(m, { id: "root" }); return m; });
        var parent = p.replace(/\/[^/]*$/, "") || "/";
        return resolve(parent).then(function (pm) {
            if (pm.mimeType !== FOLDER) throw kit.fileError(E.NOT_DIR, "Not a folder: " + parent);
            return namesIn(contentId(pm));
        }).then(function (list) {
            list.forEach(function (x) { var cp = (parent === "/" ? "" : parent) + "/" + x.name; if (!meta[cp]) meta[cp] = x.m; });
            if (!meta[p]) throw kit.fileError(E.NOT_FOUND, "No such file or folder: " + p);
            return meta[p];
        });
    }
    function exists(p) { return resolve(p).then(function () { return true; }, function (e) { if (e.code === E.NOT_FOUND) return false; throw e; }); }
    // A folder to put a file in: not Shared with me itself (Drive has no such folder).
    function into(pm, parent) {
        if (pm.mimeType !== FOLDER) throw kit.fileError(E.NOT_DIR, "Not a folder: " + parent);
        if (pm.virtual) throw kit.fileError(E.PERMISSION, SHARED_NAME + " is what others shared with you: save into a folder of yours");
        return contentId(pm);
    }
    // What changes a file's place or name forgets what was listed.
    function forget() { meta = {}; listed = {}; }

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
                return namesIn(contentId(m));
            }).then(function (list) {
                return list.map(function (x) { return entryOf(x.m, (p === "/" ? "" : p) + "/" + x.name); });
            });
        },

        stat: function (p) {
            return resolve(p).then(function (m) {
                // drive.file: the top is not asked of Google; whether the sign-in still holds is
                // (an account's sync stats "/": a grant ended at Google shows on the account).
                if (p === "/" && perFile) return json("GET", api + "/about?fields=user").then(function () { return entryOf(m, p); });
                return entryOf(m, p);
            });
        },

        download: function (entry, sink, o) {
            return resolve(entry.path).then(function (m) {
                if (webOnly(m)) {
                    throw kit.fileError(E.UNSUPPORTED, "\"" + m.name + "\" is a " + (WEB_ONLY[m.mimeType] || "Google document") +
                                        ": there is no file of it to open here. Open it in Google Drive in the browser" + (m.webViewLink ? " (" + m.webViewLink + ")" : ""));
                }
                var x = EXPORTS[m.mimeType];
                if (x) {
                    // A Google document: exported whole (its size is not known before).
                    o.onProgress(0, 0);
                    return authed(function (t) {
                        return { method: "GET", url: api + "/files/" + encodeURIComponent(contentId(m)) + "/export?mimeType=" + encodeURIComponent(x[0]),
                                 headers: { Authorization: "Bearer " + t }, binary: true, transferBytes: EXPORT_LIMIT };
                    }).then(function (res) {
                        if (res.status !== 200) throw driveError(res, "export " + entry.path);
                        return sink.write(res.bytes || new Uint8Array(0));
                    });
                }
                return kit.downloadInRanges(entry.size, sink, o, function (start, end) {
                    return authed(function (t) {
                        var h = { Authorization: "Bearer " + t };
                        if (end >= 0) h.Range = "bytes=" + start + "-" + end;
                        return { method: "GET", url: api + "/files/" + encodeURIComponent(contentId(m)) + "?alt=media", headers: h, binary: true,
                                 transferBytes: end >= 0 ? end - start + 1 : o.chunkSize };
                    }).then(function (res) {
                        if (res.status === 404 || res.status === 403) throw driveError(res, "download " + entry.path);
                        return res;
                    });
                }, "download " + entry.path);
            });
        },

        upload: function (p, source, o) {
            var parent = p.replace(/\/[^/]*$/, "") || "/", name = p.slice(p.lastIndexOf("/") + 1);
            var type = source.mimeType || "application/octet-stream";
            return Promise.all([resolve(parent), exists(p)]).then(function (r) {
                var pm = r[0], there = r[1] ? meta[p] : null;
                var folderId = into(pm, parent);
                if (there && !o.overwrite) throw kit.fileError(E.EXISTS, "Already exists: " + p);
                if (there && there.mimeType === FOLDER) throw kit.fileError(E.IS_DIR, "A folder has this name: " + p);
                if (there && isGoogleKind(there.mimeType))
                    throw kit.fileError(E.PERMISSION, p + " is a Google document: edit it in Google Drive, or save this under another name");
                var target = there ? upload + "/files/" + encodeURIComponent(contentId(there)) : upload + "/files";
                var method = there ? "PATCH" : "POST";
                var metadata = there ? {} : { name: name, parents: [folderId] };
                if (source.size <= o.chunkSize) {
                    o.onProgress(0, source.size);
                    return source.read(0, source.size).then(function (bytes) {
                        if (o.signal.aborted) throw kit.fileError(E.CANCELED, "Cancelled");
                        var mp = multipartBody(metadata, bytes, type);
                        return call(method, target + "?uploadType=multipart&fields=" + encodeURIComponent(FIELDS), mp.body, [200], { "Content-Type": mp.type },
                                    mp.body.length);
                    }).then(function (res) {
                        o.onProgress(source.size, source.size);
                        forget();
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
                        return authed(function (t) {
                            return { method: "PUT", url: session, body: bytes, transferBytes: bytes.length, headers: {
                                Authorization: "Bearer " + t,
                                "Content-Range": "bytes " + offset + "-" + (offset + bytes.length - 1) + "/" + source.size } };
                        }).then(function (r2) {
                            if (r2.status === 308) return;
                            if (r2.status === 200 || r2.status === 201) { done = N.jsonOf(r2); return; }
                            throw driveError(r2, "upload " + p);
                        });
                    }).catch(function (e) {
                        return N.send(ctx, { method: "DELETE", url: session }).catch(function () {}).then(function () { throw e; });
                    });
                }).then(function () {
                    forget();
                    return done ? entryOf(done, p) : drive.stat(p);
                });
            });
        },

        mkdir: function (p) {
            var parent = p.replace(/\/[^/]*$/, "") || "/", name = p.slice(p.lastIndexOf("/") + 1);
            return Promise.all([resolve(parent), exists(p)]).then(function (r) {
                var folderId = into(r[0], parent);
                if (r[1]) throw kit.fileError(E.EXISTS, "Already exists: " + p);
                return json("POST", api + "/files?fields=" + encodeURIComponent(FIELDS), { name: name, mimeType: FOLDER, parents: [folderId] });
            }).then(function (m) { forget(); return entryOf(m, p); });
        },

        move: function (from, to, o) {
            var parent = to.replace(/\/[^/]*$/, "") || "/", name = to.slice(to.lastIndexOf("/") + 1);
            return Promise.all([resolve(from), resolve(parent), exists(to)]).then(function (r) {
                var m = r[0], folderId = into(r[1], parent);
                if (m.virtual) throw kit.fileError(E.PERMISSION, SHARED_NAME + " cannot move");
                var clear = r[2] ? (o.overwrite ? trash(meta[to].id) : Promise.reject(kit.fileError(E.EXISTS, "Already exists: " + to))) : Promise.resolve();
                return clear.then(function () {
                    var url = api + "/files/" + encodeURIComponent(m.id) + "?fields=" + encodeURIComponent(FIELDS) +
                        "&addParents=" + encodeURIComponent(folderId) + "&removeParents=" + encodeURIComponent((m.parents || []).join(","));
                    return json("PATCH", url, { name: name });
                });
            }).then(function () { forget(); });
        },

        copy: function (from, to, o) {
            var parent = to.replace(/\/[^/]*$/, "") || "/", name = to.slice(to.lastIndexOf("/") + 1);
            return Promise.all([resolve(from), resolve(parent), exists(to)]).then(function (r) {
                if (r[0].mimeType === FOLDER) throw kit.fileError(E.UNSUPPORTED, "Google Drive copies files, not folders");
                var folderId = into(r[1], parent);
                var clear = r[2] ? (o.overwrite ? trash(meta[to].id) : Promise.reject(kit.fileError(E.EXISTS, "Already exists: " + to))) : Promise.resolve();
                return clear.then(function () {
                    return json("POST", api + "/files/" + encodeURIComponent(contentId(r[0])) + "/copy?fields=" + encodeURIComponent(FIELDS), { name: name, parents: [folderId] });
                });
            }).then(function () { forget(); });
        },

        remove: function (p) {
            return resolve(p).then(function (m) {
                if (m.virtual) throw kit.fileError(E.PERMISSION, SHARED_NAME + " cannot be removed");
                return trash(m.id);
            }).then(function () { forget(); });
        },

        search: function (query, so) {
            var words = String(query).split(/\s+/).filter(Boolean);
            var cond = words.map(function (w) { return "name contains " + q(w); }).join(" and ") + " and trashed = false";
            var url = api + "/files?q=" + encodeURIComponent(cond) + "&fields=" + encodeURIComponent("files(" + FIELDS + ")") + "&pageSize=" + so.limit + "&spaces=drive";
            return json("GET", url).then(function (r) {
                // Where each result is: its folder's path (its parents asked once
                // per folder) and its name there (named, as listing it gives it).
                // {path, key}: the folder's path and the id it is listed by; null: not reachable from the top here.
                var byId = {};
                function placeOf(m) {
                    var parent = m.parents && m.parents[0];
                    if (!parent) {
                        // No parents the person may see: drive.file, at the top; all your Drive, shared with them.
                        if (perFile) return Promise.resolve({ path: "", key: "root" });
                        return Promise.resolve(m.sharedWithMe ? { path: "/" + SHARED_NAME, key: SHARED_ID } : null);
                    }
                    return folderPath(parent).then(function (pp) { return pp === null ? null : { path: pp, key: parent }; }, function (e) {
                        // drive.file: a folder Phoenix may not see; what is in it is at the top here.
                        // All your Drive: a folder gone (trashed): not a result.
                        if (e.code === E.NOT_FOUND) return perFile ? { path: "", key: "root" } : null;
                        throw e;
                    });
                }
                function folderPath(id) {
                    if (byId[id]) return byId[id];
                    byId[id] = json("GET", api + "/files/" + encodeURIComponent(id) + "?fields=" + encodeURIComponent(FIELDS)).then(function (m) {
                        return placeOf(m).then(function (at) { return at === null ? null : nameIn(at, m); });
                    });
                    return byId[id];
                }
                function nameIn(at, m) {
                    // My Drive's own id, as parents name it, is listed as "root".
                    return namesIn(at.key === rootId ? "root" : at.key).then(function (list) {
                        var x = list.filter(function (y) { return y.m.id === m.id; })[0];
                        return at.path + "/" + (x ? x.name : shownName(m));
                    });
                }
                var rootId = "root";
                var top = perFile ? Promise.resolve({ id: "root" }) : json("GET", api + "/files/root?fields=id");
                return top.then(function (root) {
                    rootId = root.id;
                    byId[root.id] = Promise.resolve("");
                    return Promise.all((r.files || []).map(real).map(function (m) {
                        return placeOf(m).then(function (at) {
                            if (at === null) return null;
                            return nameIn(at, m).then(function (path) {
                                if (so.path !== "/" && path.indexOf(so.path + "/") !== 0) return null;
                                return entryOf(m, path);
                            });
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
                            params: { access_type: "offline", prompt: "consent" },
                            // drive.file: Google's Picker in the sign-in (files and folders, several at once).
                            pickerParams: { trigger_onepick: "true", allow_multiple: "true", allow_folder_selection: "true" } },
                   ACCESS: { "drive.file": "https://www.googleapis.com/auth/drive.file", drive: "https://www.googleapis.com/auth/drive" },
                   HOSTS: ["www.googleapis.com"] };
