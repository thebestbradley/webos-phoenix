// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The hello-world connector of docs/SYNERGY-SDK.md: a news feed (RSS or
// Atom) as an account, its entries read one way into a db8 kind. The kit
// does the rest: the accounts service's callbacks, the periodic sync, item
// records (an entry is written once, and again only when it changes), the
// sync state, backoff on 429 / 503, and removing every entry when the
// account goes.
//
// FEEDS is a new capability (docs/SYNERGY-CONNECTORS.md section 1, open
// question 4): no generic kind is agreed yet, so the entries go to the
// connector's own kind, org.example.feeds.entry:1.

"use strict";

var kit = require("@phoenix/connector-kit");
var feed = require("./lib/feed");

// The feed, fetched with the validators of the last fetch (If-None-Match,
// If-Modified-Since: RFC 9110 13.1), so an unchanged feed costs a 304.
function fetchFeed(ctx, url, cache) {
    var headers = { Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" };
    if (cache && cache.etag) headers["If-None-Match"] = cache.etag;
    if (cache && cache.modified) headers["If-Modified-Since"] = cache.modified;
    return ctx.http.request({ method: "GET", url: url, headers: headers }).then(function (res) {
        if (res.status === 304) return { notModified: true };
        if (res.status === 401 || res.status === 403)
            throw Object.assign(new Error("The feed asks for a sign-in"), { status: 401, errorCode: "401_UNAUTHORIZED" });
        if (res.status >= 400) throw Object.assign(new Error("HTTP " + res.status + " from the feed"), { status: res.status });
        return { parsed: feed.parse(res.body), etag: res.headers.etag || "", modified: res.headers["last-modified"] || "" };
    });
}

function httpUrl(u) {
    var url = String(u || "").trim().replace(/^feed:(\/\/)?/i, "https://");
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    return new URL(url).href;
}

module.exports = kit.defineConnector({
    service: "org.example.service.feeds",
    templateIds: ["org.example.feeds"],
    kinds: { state: "org.example.feeds.state:1", item: "org.example.feeds.item:1" },
    userAgent: "webOS-Phoenix-Feeds-Example/0.1",

    // The sign-in page sends {config: {url}}: the feed must be one.
    validate: function (ctx, p) {
        var url = httpUrl((p.config && p.config.url) || p.username);
        ctx.http.allowHost(new URL(url).host);
        return fetchFeed(ctx, url, null).then(function (r) {
            return {
                username: url,
                credentials: { common: { url: url } },
                config: { url: url, title: r.parsed.title }
            };
        });
    },

    capabilities: {
        "org.example.feeds.entries": {
            capability: "FEEDS",
            kind: "org.example.feeds.entry:1",
            fields: ["title", "link", "summary", "published", "updated", "feedTitle"],
            // Every entry the feed lists now (a full listing: what it no
            // longer lists is deleted); the token keeps the HTTP validators.
            pull: function (ctx, token) {
                var cache = token ? JSON.parse(token) : null;
                return fetchFeed(ctx, ctx.config.url, cache).then(function (r) {
                    if (r.notModified) return { changes: [], nextToken: token };
                    return {
                        full: true,
                        nextToken: JSON.stringify({ etag: r.etag, modified: r.modified }),
                        changes: r.parsed.entries.filter(function (e) { return e.id; }).map(function (e) {
                            return {
                                remoteId: e.id,
                                etag: String(e.updated || "") + "|" + e.title,
                                fields: { title: e.title, link: e.link, summary: e.summary, published: e.published,
                                          updated: e.updated, feedTitle: r.parsed.title }
                            };
                        })
                    };
                });
            }
        }
    },

    // A feed is read again every hour, when the device is online.
    schedule: { every: "1h" }
});
