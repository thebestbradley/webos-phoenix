// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A WebDAV client for CardDAV (RFC 6352) and CalDAV (RFC 4791): service
// discovery (RFC 6764 well-known URIs, RFC 5397 current-user-principal, the
// addressbook-home-set and calendar-home-set), collection listing, sync
// (RFC 6578 sync-collection with a sync-token, else the collection's
// CalendarServer ctag and each resource's etag), multiget, and conditional
// PUT / DELETE with If-Match / If-None-Match.
//
// It does no I/O itself: request({method, url, headers, body}) is passed in
// and resolves to {status, headers (lower-case names), body (text)}. The
// device service uses Node's http/https (node-http.js); the simulator uses
// fetch, through tools/serve-rootfs.py's proxy when the page is served
// over HTTP (runtime/phoenix-runtime.js, block "CardDAV and CalDAV").
// Redirects are followed here, keeping the method, so every transport can
// return 3xx responses as they are.

"use strict";

var X = require("@phoenix/synckit").xml;

var NS = {
    DAV: "DAV:",
    CARD: "urn:ietf:params:xml:ns:carddav",
    CAL: "urn:ietf:params:xml:ns:caldav",
    CS: "http://calendarserver.org/ns/",
    ICAL: "http://apple.com/ns/ical/"
};

function DavError(message, status, code) {
    var e = new Error(message);
    e.status = status;
    // Error codes the Accounts app understands (enyo lib/accounts/source/accounts-list.js).
    e.errorCode = code || (status === 401 || status === 403 ? "401_UNAUTHORIZED" : "HTTP_" + status);
    return e;
}

function base64(s) {
    if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64");
    var bytes = new TextEncoder().encode(s), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function resolve(href, base) { return new URL(href, base).href; }

// Same resource, ignoring percent-encoding differences and a trailing slash.
function sameUrl(a, b) {
    var norm = function (u) {
        var x = new URL(u);
        var p = x.pathname.replace(/\/+$/, "");
        try { p = decodeURIComponent(p); } catch (e) { /* keep */ }
        return x.origin + p;
    };
    try { return norm(a) === norm(b); } catch (e) { return a === b; }
}

function propfindBody(props) {
    var ns = { d: NS.DAV, card: NS.CARD, cal: NS.CAL, cs: NS.CS, ical: NS.ICAL };
    return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<d:propfind" +
        Object.keys(ns).map(function (p) { return " xmlns:" + p + "=\"" + ns[p] + "\""; }).join("") +
        "><d:prop>" + props.map(function (p) { return "<" + p + "/>"; }).join("") + "</d:prop></d:propfind>";
}

// Multistatus -> [{ href, status, props: {"ns name": element} (200 only), missing: [..] }]
function parseMultistatus(text, baseUrl) {
    var root = X.parse(text);
    var out = [];
    X.children(root, NS.DAV, "response").forEach(function (r) {
        var hrefEl = X.child(r, NS.DAV, "href");
        if (!hrefEl) return;
        var item = { href: resolve(X.text(hrefEl), baseUrl), status: 200, props: {} };
        var st = X.child(r, NS.DAV, "status");
        if (st) item.status = parseInt((/\s(\d{3})\s?/.exec(X.text(st)) || [0, 200])[1], 10);
        X.children(r, NS.DAV, "propstat").forEach(function (ps) {
            var code = parseInt((/\s(\d{3})\s?/.exec(X.text(X.child(ps, NS.DAV, "status"))) || [0, 200])[1], 10);
            if (code !== 200) return;
            var prop = X.child(ps, NS.DAV, "prop");
            (prop ? prop.children : []).forEach(function (p) { item.props[p.ns + " " + p.name] = p; });
        });
        out.push(item);
    });
    var token = X.child(root, NS.DAV, "sync-token");
    out.syncToken = token ? X.text(token) : undefined;
    return out;
}

function prop(item, ns, name) { return item.props[ns + " " + name] || null; }
function hasChild(el, ns, name) { return !!(el && X.child(el, ns, name)); }
function unquote(etag) { return etag ? String(etag).trim() : ""; }

function createClient(options) {
    var request = options.request;
    var auth = "Basic " + base64((options.username || "") + ":" + (options.password || ""));
    var log = options.log || function () {};
    var server = normalizeServer(options.serverUrl);

    function call(method, url, headers, body, hops) {
        var h = { Authorization: auth };
        Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
        if (body !== undefined && !h["Content-Type"]) h["Content-Type"] = "application/xml; charset=utf-8";
        return request({ method: method, url: url, headers: h, body: body }).then(function (res) {
            if (res.status >= 300 && res.status < 400 && res.headers.location && (hops || 0) < 5) {
                var next = resolve(res.headers.location, url);
                log(method + " " + url + " -> " + res.status + " " + next);
                return call(method, next, headers, body, (hops || 0) + 1).then(function (r) {
                    r.url = r.url || next;
                    return r;
                });
            }
            res.url = res.url || url;
            if (res.status === 401) throw DavError("Authentication failed for " + url, 401);
            return res;
        });
    }

    function propfind(url, depth, props) {
        return call("PROPFIND", url, { Depth: String(depth) }, propfindBody(props)).then(function (res) {
            if (res.status !== 207) throw DavError("PROPFIND " + url + " failed: HTTP " + res.status, res.status);
            var list = parseMultistatus(res.body, res.url);
            list.url = res.url;
            return list;
        });
    }

    function report(url, depth, body) {
        return call("REPORT", url, { Depth: String(depth) }, body).then(function (res) {
            if (res.status !== 207) {
                var err = DavError("REPORT " + url + " failed: HTTP " + res.status, res.status);
                if ((res.status === 403 || res.status === 409) && /valid-sync-token/.test(res.body || "")) err.invalidSyncToken = true;
                throw err;
            }
            return parseMultistatus(res.body, res.url);
        });
    }

    // ---- Discovery -------------------------------------------------------------

    function hrefOf(item, ns, name) {
        var el = prop(item, ns, name);
        var h = el && X.child(el, NS.DAV, "href");
        return h ? resolve(X.text(h), item.href) : null;
    }

    // The principal for one service ("carddav" / "caldav"): the well-known
    // URI of the server's origin first (RFC 6764 section 5), then the URL
    // the user typed.
    function findPrincipal(service) {
        var candidates = [];
        var origin = new URL(server).origin;
        candidates.push(origin + "/.well-known/" + service);
        candidates.push(server);
        var i = 0;
        function next() {
            if (i >= candidates.length) return Promise.resolve(null);
            var url = candidates[i++];
            return propfind(url, 0, ["d:current-user-principal", "d:resourcetype"]).then(function (list) {
                var item = list[0];
                var p = item && hrefOf(item, NS.DAV, "current-user-principal");
                if (p) return { principal: p, context: list.url };
                return next();
            }, function (e) {
                if (e.status === 401) throw e;
                log("discovery: " + url + ": " + e.message);
                return next();
            });
        }
        return next();
    }

    function listCollections(home, kind) {
        return propfind(home, 1, ["d:resourcetype", "d:displayname", "cs:getctag", "d:sync-token",
                                  "d:supported-report-set", "cal:supported-calendar-component-set",
                                  "ical:calendar-color", "d:current-user-privilege-set", "card:addressbook-description"])
            .then(function (list) {
                return list.filter(function (item) {
                    var rt = prop(item, NS.DAV, "resourcetype");
                    return kind === "addressbook" ? hasChild(rt, NS.CARD, "addressbook") : hasChild(rt, NS.CAL, "calendar");
                }).map(function (item) { return describeCollection(item, kind); });
            });
    }

    function describeCollection(item, kind) {
        var reports = prop(item, NS.DAV, "supported-report-set");
        var comps = prop(item, NS.CAL, "supported-calendar-component-set");
        var privs = prop(item, NS.DAV, "current-user-privilege-set");
        var components = comps ? X.children(comps, NS.CAL, "comp").map(function (c) { return c.attrs.name; })
                               : ["VEVENT", "VTODO"];
        var color = X.text(prop(item, NS.ICAL, "calendar-color"));
        var canWrite = !privs || JSON.stringify(privs).indexOf("\"write") >= 0 ||
            (JSON.stringify(privs).indexOf("\"all\"") >= 0);
        return {
            url: item.href,
            kind: kind,
            displayName: X.text(prop(item, NS.DAV, "displayname")) || decodeURIComponent(item.href.replace(/\/+$/, "").split("/").pop()),
            ctag: X.text(prop(item, NS.CS, "getctag")) || undefined,
            syncToken: X.text(prop(item, NS.DAV, "sync-token")) || undefined,
            supportsSync: !!(reports && JSON.stringify(reports).indexOf("sync-collection") >= 0) ||
                          !!X.text(prop(item, NS.DAV, "sync-token")),
            components: components,
            color: color ? color.slice(0, 7) : undefined,
            readOnly: !canWrite
        };
    }

    // Everything the account needs: principal, home sets and collections.
    // A URL that is itself an address book or calendar is used as the only one.
    function discover() {
        var result = { serverUrl: server, addressbooks: [], calendars: [] };
        return propfind(server, 0, ["d:resourcetype", "d:displayname", "cs:getctag", "d:sync-token",
                                    "d:supported-report-set", "cal:supported-calendar-component-set", "ical:calendar-color"])
            .then(function (list) {
                var item = list[0], rt = item && prop(item, NS.DAV, "resourcetype");
                if (hasChild(rt, NS.CARD, "addressbook")) result.addressbooks.push(describeCollection(item, "addressbook"));
                if (hasChild(rt, NS.CAL, "calendar")) result.calendars.push(describeCollection(item, "calendar"));
            }, function (e) {
                // No answer at all (host not found, refused, TLS): give up now.
                if (e.status === 401 || !e.status) throw e;
                // Servers may refuse PROPFIND on "/" (only the well-known URIs work).
                log("discovery: " + server + ": " + e.message);
            })
            .then(function () {
                if (result.addressbooks.length || result.calendars.length) return result;
                return Promise.all([findPrincipal("carddav"), findPrincipal("caldav")]).then(function (found) {
                    var principals = found.filter(Boolean).map(function (f) { return f.principal; });
                    if (!principals.length) throw DavError("No CardDAV or CalDAV service found at " + server, 404, "NO_DAV_SERVICE");
                    // Card and cal principals are the same on most servers.
                    var unique = principals.filter(function (p, i) { return principals.indexOf(p) === i; });
                    result.principalUrl = unique[0];
                    return Promise.all(unique.map(function (p) {
                        return propfind(p, 0, ["card:addressbook-home-set", "cal:calendar-home-set", "d:displayname"]);
                    })).then(function (lists) {
                        lists.forEach(function (list) {
                            var item = list[0];
                            if (!item) return;
                            result.addressbookHome = result.addressbookHome || hrefOf(item, NS.CARD, "addressbook-home-set");
                            result.calendarHome = result.calendarHome || hrefOf(item, NS.CAL, "calendar-home-set");
                            result.displayName = result.displayName || X.text(prop(item, NS.DAV, "displayname"));
                        });
                        return Promise.all([
                            result.addressbookHome ? listCollections(result.addressbookHome, "addressbook") : [],
                            result.calendarHome ? listCollections(result.calendarHome, "calendar") : []
                        ]);
                    }).then(function (cols) {
                        result.addressbooks = cols[0];
                        result.calendars = cols[1];
                        return result;
                    });
                });
            });
    }

    // Current ctag and sync-token of one collection.
    function collectionState(url) {
        return propfind(url, 0, ["cs:getctag", "d:sync-token"]).then(function (list) {
            var item = list[0] || { props: {} };
            return { ctag: X.text(prop(item, NS.CS, "getctag")) || undefined,
                     syncToken: X.text(prop(item, NS.DAV, "sync-token")) || undefined };
        });
    }

    // ---- Sync ------------------------------------------------------------------

    // RFC 6578: changes since token (all members for an empty token).
    // -> { changed: [{href, etag}], removed: [href], syncToken, truncated }
    function syncCollection(url, token) {
        var body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<d:sync-collection xmlns:d=\"DAV:\">" +
            "<d:sync-token>" + X.escape(token || "") + "</d:sync-token><d:sync-level>1</d:sync-level>" +
            "<d:prop><d:getetag/></d:prop></d:sync-collection>";
        return report(url, 0, body).then(function (list) {
            var out = { changed: [], removed: [], syncToken: list.syncToken, truncated: false };
            list.forEach(function (item) {
                if (sameUrl(item.href, url)) {
                    if (item.status === 507) out.truncated = true;
                    return;
                }
                if (item.status === 404) { out.removed.push(item.href); return; }
                var etag = X.text(prop(item, NS.DAV, "getetag"));
                if (/\/$/.test(item.href)) return; // a sub-collection
                out.changed.push({ href: item.href, etag: unquote(etag) });
            });
            return out;
        });
    }

    // All members and their etags (servers without sync-collection).
    function listEtags(url) {
        return propfind(url, 1, ["d:getetag", "d:resourcetype"]).then(function (list) {
            return list.filter(function (item) {
                if (sameUrl(item.href, url)) return false;
                var rt = prop(item, NS.DAV, "resourcetype");
                return !hasChild(rt, NS.DAV, "collection");
            }).map(function (item) { return { href: item.href, etag: unquote(X.text(prop(item, NS.DAV, "getetag"))) }; });
        });
    }

    // addressbook-multiget / calendar-multiget, 50 resources at a time.
    // -> [{ href, etag, data }] (resources the server no longer has are left out)
    function multiget(url, kind, hrefs) {
        var isCard = kind === "addressbook";
        var chunks = [];
        for (var i = 0; i < hrefs.length; i += 50) chunks.push(hrefs.slice(i, i + 50));
        var out = [];
        return chunks.reduce(function (p, chunk) {
            return p.then(function () {
                var body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" +
                    (isCard ? "<card:addressbook-multiget xmlns:d=\"DAV:\" xmlns:card=\"" + NS.CARD + "\">"
                            : "<cal:calendar-multiget xmlns:d=\"DAV:\" xmlns:cal=\"" + NS.CAL + "\">") +
                    "<d:prop><d:getetag/>" + (isCard ? "<card:address-data/>" : "<cal:calendar-data/>") + "</d:prop>" +
                    chunk.map(function (h) { return "<d:href>" + X.escape(new URL(h).pathname) + "</d:href>"; }).join("") +
                    (isCard ? "</card:addressbook-multiget>" : "</cal:calendar-multiget>");
                return report(url, 1, body).then(function (list) {
                    list.forEach(function (item) {
                        var data = prop(item, isCard ? NS.CARD : NS.CAL, isCard ? "address-data" : "calendar-data");
                        if (item.status !== 200 || !data) return;
                        out.push({ href: item.href, etag: unquote(X.text(prop(item, NS.DAV, "getetag"))), data: data.text });
                    });
                });
            });
        }, Promise.resolve()).then(function () { return out; });
    }

    function get(href) {
        return call("GET", href, {}).then(function (res) {
            if (res.status === 404 || res.status === 410) return null;
            if (res.status !== 200) throw DavError("GET " + href + " failed: HTTP " + res.status, res.status);
            return { href: href, etag: unquote(res.headers.etag), data: res.body };
        });
    }

    // opts.etag: If-Match (update); opts.create: If-None-Match: * (new resource).
    // -> { etag } ; a 412 throws an error with conflict = true.
    function put(href, data, contentType, opts) {
        opts = opts || {};
        var headers = { "Content-Type": contentType + "; charset=utf-8" };
        if (opts.etag) headers["If-Match"] = opts.etag;
        if (opts.create) headers["If-None-Match"] = "*";
        return call("PUT", href, headers, data).then(function (res) {
            if (res.status === 412) {
                var e = DavError("PUT " + href + ": the server copy changed", 412, "CONFLICT");
                e.conflict = true;
                throw e;
            }
            if (res.status < 200 || res.status >= 300) throw DavError("PUT " + href + " failed: HTTP " + res.status, res.status);
            // Servers may leave out the ETag when they changed the data; ask for it.
            if (res.headers.etag) return { etag: unquote(res.headers.etag) };
            return propfind(href, 0, ["d:getetag"]).then(function (list) {
                return { etag: list[0] ? unquote(X.text(prop(list[0], NS.DAV, "getetag"))) : "" };
            });
        });
    }

    function del(href, etag) {
        var headers = etag ? { "If-Match": etag } : {};
        return call("DELETE", href, headers).then(function (res) {
            if (res.status === 412) {
                var e = DavError("DELETE " + href + ": the server copy changed", 412, "CONFLICT");
                e.conflict = true;
                throw e;
            }
            if (res.status === 404 || res.status === 410) return { gone: true };
            if (res.status < 200 || res.status >= 300) throw DavError("DELETE " + href + " failed: HTTP " + res.status, res.status);
            return {};
        });
    }

    return {
        serverUrl: server, discover: discover, collectionState: collectionState, syncCollection: syncCollection,
        listEtags: listEtags, multiget: multiget, get: get, put: put, del: del, propfind: propfind
    };
}

// "cloud.example.com" -> "https://cloud.example.com/"
function normalizeServer(url) {
    url = String(url || "").trim();
    if (!url) throw DavError("No server address", 0, "BAD_SERVER");
    if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(url)) url = "https://" + url;
    var u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw DavError("Unsupported server address: " + url, 0, "BAD_SERVER");
    return u.href;
}

module.exports = { createClient: createClient, normalizeServer: normalizeServer, parseMultistatus: parseMultistatus,
                   sameUrl: sameUrl, NS: NS, DavError: DavError };
