// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The little WebDAV (RFC 4918) a backup folder needs: create the folder
// (MKCOL), list it (PROPFIND, Depth 1), and PUT, GET and DELETE files.
// Nextcloud, ownCloud, Apache mod_dav, nginx dav and most NAS boxes speak
// it. request({method, url, headers, body}) -> Promise<{status, headers,
// body}> is passed in (lib/node-http.js on a device; the simulator's goes
// through tools/serve-rootfs.py's proxy).

"use strict";

function fail(code, text, status) {
    var e = new Error(text);
    e.code = code;
    if (status) e.status = status;
    return e;
}

function basicAuth(user, password) {
    var s = unescape(encodeURIComponent(String(user || "") + ":" + String(password || "")));
    var out = typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
    return "Basic " + out;
}

function decodeXml(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// The text of the first <prefix:name> element in xml (any namespace prefix).
function element(xml, name) {
    var m = new RegExp("<(?:[A-Za-z0-9_-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?" + name + ">").exec(xml);
    return m ? decodeXml(m[1].trim()) : null;
}

// A PROPFIND multistatus -> [{href, collection, size, modified}].
function parseMultistatus(xml) {
    var out = [];
    var parts = xml.split(/<(?:[A-Za-z0-9_-]+:)?response[\s>]/).slice(1);
    parts.forEach(function (p) {
        var href = element(p, "href");
        if (!href) return;
        out.push({
            href: href,
            collection: /<(?:[A-Za-z0-9_-]+:)?collection\s*\/?>/.test(p),
            size: Number(element(p, "getcontentlength") || 0),
            modified: element(p, "getlastmodified")
        });
    });
    return out;
}

function createClient(opts) {
    var request = opts.request;
    var base = String(opts.url || "").replace(/\/*$/, "/");
    if (!/^https?:\/\//i.test(base)) throw fail("BAD_URL", "The server address must start with https:// or http://");
    var auth = opts.username ? { Authorization: basicAuth(opts.username, opts.password) } : {};

    function send(method, url, headers, body) {
        return Promise.resolve(request({ method: method, url: url, headers: Object.assign({}, auth, headers || {}), body: body }))
            .then(function (res) {
                if (res.status === 401 || res.status === 403)
                    throw fail("UNAUTHORIZED", "The server refused the user name or password", res.status);
                return res;
            }, function (e) {
                throw fail("CONNECTION_FAILED", "Could not reach the server" + (e && e.message ? ": " + e.message : ""));
            });
    }
    function fileUrl(name) { return base + encodeURIComponent(name); }

    return {
        url: base,
        // The folder, made if it is not there (MKCOL answers 405 when it is).
        ensureFolder: function () {
            return send("PROPFIND", base, { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
                "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>")
                .then(function (res) {
                    if (res.status === 207) return;
                    if (res.status !== 404) throw fail("BAD_SERVER", "The server does not speak WebDAV (HTTP " + res.status + ")", res.status);
                    return send("MKCOL", base).then(function (r) {
                        if (r.status !== 201 && r.status !== 405)
                            throw fail("BAD_SERVER", "Could not create the folder (HTTP " + r.status + ")", r.status);
                    });
                });
        },
        // The files in the folder: [{name, size, modified}].
        list: function () {
            return send("PROPFIND", base, { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
                "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/><d:getcontentlength/>" +
                "<d:getlastmodified/></d:prop></d:propfind>")
                .then(function (res) {
                    if (res.status === 404) return [];
                    if (res.status !== 207) throw fail("BAD_SERVER", "The server does not speak WebDAV (HTTP " + res.status + ")", res.status);
                    return parseMultistatus(res.body).filter(function (e) { return !e.collection; }).map(function (e) {
                        var name = decodeURIComponent(e.href.replace(/\/$/, "").split("/").pop());
                        return { name: name, size: e.size, modified: e.modified ? new Date(e.modified).toISOString() : null };
                    });
                });
        },
        put: function (name, text) {
            return send("PUT", fileUrl(name), { "Content-Type": "application/octet-stream" }, text).then(function (res) {
                if (res.status < 200 || res.status >= 300) {
                    if (res.status === 507) throw fail("NO_SPACE", "The server is out of space", 507);
                    throw fail("BAD_SERVER", "The server did not take the file (HTTP " + res.status + ")", res.status);
                }
            });
        },
        get: function (name) {
            return send("GET", fileUrl(name)).then(function (res) {
                if (res.status === 404) throw fail("NOT_FOUND", "The backup is not on the server", 404);
                if (res.status !== 200) throw fail("BAD_SERVER", "Could not read the file (HTTP " + res.status + ")", res.status);
                return res.body;
            });
        },
        remove: function (name) {
            return send("DELETE", fileUrl(name)).then(function (res) {
                if (res.status >= 300 && res.status !== 404)
                    throw fail("BAD_SERVER", "Could not delete the file (HTTP " + res.status + ")", res.status);
            });
        }
    };
}

module.exports = { createClient: createClient, parseMultistatus: parseMultistatus, basicAuth: basicAuth };
