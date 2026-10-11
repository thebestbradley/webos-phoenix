// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An S3-compatible bucket as a drive: Backblaze B2, Wasabi, MinIO, AWS S3,
// IDrive e2, Cloudflare R2 and the others that speak the S3 API, with an
// access key the user makes in the provider's console (no registration for
// Phoenix). Requests are signed with AWS Signature Version 4
// (https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html),
// the payload as UNSIGNED-PAYLOAD (over https, as the API allows), so a big
// file is never hashed in memory.
//
// Folders are key prefixes ending in "/" (ListObjectsV2 with a delimiter);
// an empty folder is the zero-byte key "folder/" (as the providers' consoles
// make them). config.prefix keeps the drive inside part of the bucket.
//
//   list      GET ?list-type=2&prefix=&delimiter=/ (continuation tokens)
//   stat      HEAD the key, else a prefix with something under it
//   download  GET with Range
//   upload    PUT, or above a chunk multipart upload (CreateMultipartUpload,
//             UploadPart, CompleteMultipartUpload; AbortMultipartUpload on
//             failure or cancel)
//   move, copy  CopyObject (x-amz-copy-source) for each key, then DELETE
//   remove    DELETE each key under it
//   search    the names under a folder that have every word (S3 has no search)
//   quota     none (S3 buckets have no fixed size)

"use strict";

var kit = require("@phoenix/connector-kit");
var synckit = require("@phoenix/synckit");
var H = require("./hash");
var N = require("./net");

var X = synckit.xml;
var S3NS = "http://s3.amazonaws.com/doc/2006-03-01/";
var E = kit.FILE_ERRORS;
var MIN_PART = 5 * 1024 * 1024;
var SEARCH_SCAN = 10000;

// RFC 3986 encoding as SigV4 wants it (unreserved kept; "/" kept in paths).
function uriEncode(s, keepSlash) {
    var out = encodeURIComponent(s).replace(/[!'()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); });
    return keepSlash ? out.replace(/%2F/g, "/") : out;
}

function amzDate(ms) {
    return new Date(ms).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * Signs a request (method, url with its query, headers): adds x-amz-date,
 * x-amz-content-sha256 and Authorization. Exported for the tests, which
 * check it against the AWS documentation's example.
 */
function sign(req, creds, region, now, payloadHash) {
    var u = new URL(req.url);
    var date = amzDate(now);
    var day = date.slice(0, 8);
    var headers = req.headers;
    headers["x-amz-date"] = date;
    headers["x-amz-content-sha256"] = payloadHash || "UNSIGNED-PAYLOAD";
    var names = Object.keys(headers).map(function (k) { return k.toLowerCase(); }).concat(["host"])
        .filter(function (k, i, a) { return a.indexOf(k) === i && (k === "host" || k === "content-type" || k === "range" || k.indexOf("x-amz-") === 0); }).sort();
    var value = function (k) {
        if (k === "host") return u.host;
        var key = Object.keys(headers).filter(function (h) { return h.toLowerCase() === k; })[0];
        return String(headers[key]).trim().replace(/\s+/g, " ");
    };
    var query = [];
    u.searchParams.forEach(function (v, k) { query.push([uriEncode(k), uriEncode(v)]); });
    query.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    var path = decodeURIComponent(u.pathname);
    var canonical = [req.method, uriEncode(path, true), query.map(function (q) { return q[0] + "=" + q[1]; }).join("&"),
                     names.map(function (k) { return k + ":" + value(k) + "\n"; }).join(""), names.join(";"),
                     headers["x-amz-content-sha256"]].join("\n");
    var scope = day + "/" + region + "/s3/aws4_request";
    var toSign = ["AWS4-HMAC-SHA256", date, scope, H.hex(H.sha256(canonical))].join("\n");
    var key = H.hmacSha256(H.hmacSha256(H.hmacSha256(H.hmacSha256("AWS4" + creds.secretAccessKey, day), region), "s3"), "aws4_request");
    headers.Authorization = "AWS4-HMAC-SHA256 Credential=" + creds.accessKeyId + "/" + scope + ", SignedHeaders=" + names.join(";") +
        ", Signature=" + H.hex(H.hmacSha256(key, toSign));
    return req;
}

function s3Error(res) {
    var t = N.textOf(res);
    var code = /<Code>([^<]*)<\/Code>/.exec(t), msg = /<Message>([^<]*)<\/Message>/.exec(t);
    return [code && code[1], msg && msg[1]].filter(Boolean).join(": ");
}

/**
 * opts: {endpoint ("https://s3.us-west-004.backblazeb2.com"), region,
 * bucket, pathStyle (bucket in the path, as MinIO; else a host name of its
 * own), prefix?, accessKeyId, secretAccessKey}.
 */
function createS3(ctx, opts) {
    var endpoint = new URL(opts.endpoint);
    var prefix = String(opts.prefix || "").replace(/^\/+/, "").replace(/\/*$/, opts.prefix ? "/" : "");
    var base = opts.pathStyle ? endpoint.origin + "/" + opts.bucket : endpoint.protocol + "//" + opts.bucket + "." + endpoint.host;
    var creds = { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey };

    function keyOf(p) { return prefix + String(p).replace(/^\/+/, ""); }
    function pathOf(key) { return "/" + key.slice(prefix.length).replace(/\/$/, ""); }

    function req(method, key, query, headers, body, extra) {
        var q = Object.keys(query || {}).map(function (k) { return uriEncode(k) + (query[k] === "" ? "=" : "=" + uriEncode(String(query[k]))); }).join("&");
        var r = { method: method, url: base + "/" + uriEncode(key, true) + (q ? "?" + q : ""), headers: Object.assign({}, headers || {}) };
        if (body !== undefined) r.body = body;
        Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
        sign(r, creds, opts.region || "us-east-1", ctx.now());
        return N.send(ctx, r).then(function (res) {
            if (res.status === 403 && /SignatureDoesNotMatch|InvalidAccessKeyId|InvalidToken/.test(N.textOf(res)))
                throw kit.httpError(401, method + " " + (key || "/"), s3Error(res));
            return res;
        });
    }

    // Every page of a listing.
    function listAll(p, delimiter, maxKeys) {
        var out = { files: [], folders: [] };
        function page(token) {
            var q = { "list-type": "2", prefix: p };
            if (delimiter) q.delimiter = "/";
            if (token) q["continuation-token"] = token;
            if (maxKeys) q["max-keys"] = String(maxKeys);
            return req("GET", "", q).then(function (res) {
                if (res.status === 404) throw kit.fileError(E.NOT_FOUND, "No such bucket: " + opts.bucket);
                N.expect(res, [200], "List " + (p || "/"), s3Error);
                var doc = X.parse(N.textOf(res));
                X.children(doc, S3NS, "Contents").forEach(function (c) {
                    out.files.push({ key: X.text(X.child(c, S3NS, "Key")), size: Number(X.text(X.child(c, S3NS, "Size"))) || 0,
                                     mtime: Date.parse(X.text(X.child(c, S3NS, "LastModified"))) || 0, etag: X.text(X.child(c, S3NS, "ETag")) });
                });
                X.children(doc, S3NS, "CommonPrefixes").forEach(function (c) { out.folders.push(X.text(X.child(c, S3NS, "Prefix"))); });
                var next = X.text(X.child(doc, S3NS, "NextContinuationToken"));
                var more = X.text(X.child(doc, S3NS, "IsTruncated")) === "true";
                if (more && next && !maxKeys && out.files.length < SEARCH_SCAN) return page(next);
                return out;
            });
        }
        return page(null);
    }

    function fileEntry(f) {
        var path = pathOf(f.key);
        var e = { name: path.slice(path.lastIndexOf("/") + 1), path: path, type: "file", size: f.size, mtime: f.mtime };
        if (f.etag) e.etag = f.etag;
        return e;
    }
    function folderEntry(key) {
        var path = pathOf(key);
        return { name: path.slice(path.lastIndexOf("/") + 1), path: path, type: "directory", size: 0, mtime: 0 };
    }

    function head(key) {
        return req("HEAD", key).then(function (res) {
            if (res.status === 404) return null;
            N.expect(res, [200], "HEAD " + key);
            return res;
        });
    }

    // Every key of a file or a folder (with its folder key).
    function keysUnder(p) {
        var key = keyOf(p);
        return head(key).then(function (h) {
            if (h) return [key];
            return listAll(key + "/", false).then(function (l) { return l.files.map(function (f) { return f.key; }); });
        });
    }

    var drive = {
        list: function (p) {
            var dir = p === "/" ? prefix : keyOf(p) + "/";
            return listAll(dir, true).then(function (l) {
                var out = l.folders.map(folderEntry).concat(l.files.filter(function (f) { return f.key !== dir; }).map(fileEntry));
                if (!out.length && p !== "/") {
                    return head(keyOf(p)).then(function (h) {
                        if (h) throw kit.fileError(E.NOT_DIR, "Not a folder: " + p);
                        return head(dir).then(function (marker) {
                            if (!marker) throw kit.fileError(E.NOT_FOUND, "No such folder: " + p);
                            return [];
                        });
                    });
                }
                return out;
            });
        },

        stat: function (p) {
            if (p === "/") return listAll(prefix, true, 1).then(function () { return { name: "", path: "/", type: "directory", size: 0, mtime: 0 }; });
            var key = keyOf(p);
            return head(key).then(function (h) {
                if (h) {
                    var e = { name: p.slice(p.lastIndexOf("/") + 1), path: p, type: "file", size: Number(h.headers["content-length"]) || 0,
                              mtime: Date.parse(h.headers["last-modified"] || "") || 0 };
                    if (h.headers.etag) e.etag = h.headers.etag;
                    if (h.headers["content-type"]) e.mimeType = h.headers["content-type"];
                    return e;
                }
                return listAll(key + "/", false, 1).then(function (l) {
                    if (!l.files.length && !l.folders.length) throw kit.fileError(E.NOT_FOUND, "No such file or folder: " + p);
                    return folderEntry(key + "/");
                });
            });
        },

        download: function (entry, sink, o) {
            var key = keyOf(entry.path);
            return kit.downloadInRanges(entry.size, sink, o, function (start, end) {
                return req("GET", key, null, end >= 0 ? { Range: "bytes=" + start + "-" + end } : {}, undefined, { binary: true });
            }, "GET " + entry.path);
        },

        upload: function (p, source, o) {
            var key = keyOf(p);
            var type = source.mimeType || "application/octet-stream";
            var check = o.overwrite ? Promise.resolve() : head(key).then(function (h) { if (h) throw kit.fileError(E.EXISTS, "Already exists: " + p); });
            return check.then(function () {
                if (source.size <= Math.max(o.chunkSize, MIN_PART)) {
                    o.onProgress(0, source.size);
                    return source.read(0, source.size).then(function (bytes) {
                        if (o.signal.aborted) throw kit.fileError(E.CANCELED, "Cancelled");
                        return req("PUT", key, null, { "Content-Type": type }, bytes);
                    }).then(function (res) {
                        N.expect(res, [200], "PUT " + p, s3Error);
                        o.onProgress(source.size, source.size);
                    });
                }
                return multipart(key, source, Object.assign({}, o, { chunkSize: Math.max(o.chunkSize, MIN_PART) }), type);
            }).then(function () { return drive.stat(p); });
        },

        mkdir: function (p) {
            var key = keyOf(p);
            return keysUnder(p).then(function (keys) {
                if (keys.length) throw kit.fileError(E.EXISTS, "Already exists: " + p);
                return req("PUT", key + "/", null, { "Content-Type": "application/x-directory" }, new Uint8Array(0));
            }).then(function (res) { N.expect(res, [200], "PUT " + p + "/", s3Error); });
        },

        copy: function (from, to, o) { return copyKeys(from, to, o, false); },
        move: function (from, to, o) { return copyKeys(from, to, o, true); },

        remove: function (p) {
            return keysUnder(p).then(function (keys) {
                if (!keys.length) return head(keyOf(p) + "/").then(function (m) {
                    if (!m) throw kit.fileError(E.NOT_FOUND, "No such file or folder: " + p);
                    return ["" + keyOf(p) + "/"];
                }).then(del);
                return del(keys.concat([keyOf(p) + "/"]));
            });
        },

        search: function (query, so) {
            var words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
            var dir = so.path === "/" ? prefix : keyOf(so.path) + "/";
            return listAll(dir, false).then(function (l) {
                var seen = {}, out = [];
                l.files.forEach(function (f) {
                    var rel = f.key.slice(dir.length).replace(/\/$/, "");
                    var parts = rel.split("/");
                    // The file, and each folder on its way that matches.
                    parts.forEach(function (name, i) {
                        var low = name.toLowerCase();
                        if (!name || !words.every(function (w) { return low.indexOf(w) >= 0; })) return;
                        var key = dir + parts.slice(0, i + 1).join("/");
                        if (seen[key]) return;
                        seen[key] = true;
                        out.push(i === parts.length - 1 && !/\/$/.test(f.key) ? fileEntry(f) : folderEntry(key + "/"));
                    });
                });
                return out.slice(0, so.limit);
            });
        }
    };

    function del(keys) {
        return keys.reduce(function (prev, k) {
            return prev.then(function () {
                return req("DELETE", k).then(function (res) { N.expect(res, [200, 204, 404], "DELETE " + k, s3Error); });
            });
        }, Promise.resolve());
    }

    function copyKeys(from, to, o, move) {
        var src = keyOf(from), dst = keyOf(to);
        return keysUnder(from).then(function (keys) {
            if (!keys.length) throw kit.fileError(E.NOT_FOUND, "No such file or folder: " + from);
            return (o.overwrite ? Promise.resolve([]) : keysUnder(to)).then(function (there) {
                if (there.length) throw kit.fileError(E.EXISTS, "Already exists: " + to);
                return keys.reduce(function (prev, k) {
                    return prev.then(function () {
                        var target = k === src ? dst : dst + k.slice(src.length);
                        return req("PUT", target, null, { "x-amz-copy-source": "/" + opts.bucket + "/" + uriEncode(k, true) }).then(function (res) {
                            N.expect(res, [200], "Copy " + k, s3Error);
                            if (/<Error>/.test(N.textOf(res))) throw kit.fileError(E.IO, "Copy " + k + ": " + s3Error(res));
                        });
                    });
                }, Promise.resolve()).then(function () { return move ? del(keys) : null; });
            });
        });
    }

    function multipart(key, source, o, type) {
        var uploadId = null, parts = [];
        return req("POST", key, { uploads: "" }, { "Content-Type": type }).then(function (res) {
            N.expect(res, [200], "CreateMultipartUpload", s3Error);
            uploadId = X.text(X.child(X.parse(N.textOf(res)), S3NS, "UploadId"));
            if (!uploadId) throw kit.fileError(E.IO, "The server gave no upload id");
            return kit.forEachChunk(source, o, function (bytes) {
                var n = parts.length + 1;
                return req("PUT", key, { partNumber: n, uploadId: uploadId }, {}, bytes).then(function (r) {
                    N.expect(r, [200], "UploadPart " + n, s3Error);
                    parts.push({ n: n, etag: r.headers.etag });
                });
            });
        }).then(function () {
            var body = "<CompleteMultipartUpload xmlns=\"" + S3NS + "\">" + parts.map(function (p) {
                return "<Part><PartNumber>" + p.n + "</PartNumber><ETag>" + X.escape(p.etag || "") + "</ETag></Part>";
            }).join("") + "</CompleteMultipartUpload>";
            return req("POST", key, { uploadId: uploadId }, { "Content-Type": "application/xml" }, body);
        }).then(function (res) {
            N.expect(res, [200], "CompleteMultipartUpload", s3Error);
            if (/<Error>/.test(N.textOf(res))) throw kit.fileError(E.IO, "CompleteMultipartUpload: " + s3Error(res));
        }).catch(function (e) {
            if (!uploadId) throw e;
            return req("DELETE", key, { uploadId: uploadId }).catch(function () {}).then(function () { throw e; });
        });
    }

    return drive;
}

module.exports = { createS3: createS3, sign: sign };
