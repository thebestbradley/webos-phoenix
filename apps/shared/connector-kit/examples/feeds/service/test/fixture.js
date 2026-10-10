// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The News Feed connector's conformance fixture (docs/SYNERGY-SDK.md
// "Testing"; phoenix-connector test): its template, what its sign-in page
// sends, and a fake feed server, in memory: an Atom feed of three entries
// with an ETag (an unchanged feed answers 304 Not Modified), and 401 and
// 429 on demand.

"use strict";

var path = require("path");
var fs = require("fs");

var FEED_URL = "https://news.example/feed.atom";

function atom(entries) {
    return ["<?xml version=\"1.0\" encoding=\"utf-8\"?>", "<feed xmlns=\"http://www.w3.org/2005/Atom\">",
        "<title>Example News</title>", "<link href=\"https://news.example/\"/>", "<id>urn:example:news</id>",
        "<updated>2026-10-09T12:00:00Z</updated>"].concat(entries.map(function (e) {
        return "<entry><id>" + e.id + "</id><title>" + e.title + "</title><link href=\"" + e.link + "\"/>" +
            "<updated>" + e.updated + "</updated><summary type=\"html\">&lt;p&gt;" + e.summary + "&lt;/p&gt;</summary></entry>";
    })).concat(["</feed>"]).join("\n");
}

function createServer() {
    var count = 0, unauthorized = false, retryAfter = 0;
    var entries = [
        { id: "urn:example:news:1", title: "Phoenix rises", link: "https://news.example/1", updated: "2026-10-09T10:00:00Z", summary: "Cards are back." },
        { id: "urn:example:news:2", title: "Synergy, modern", link: "https://news.example/2", updated: "2026-10-09T11:00:00Z", summary: "One kit for every account." },
        { id: "urn:example:news:3", title: "Just Type", link: "https://news.example/3", updated: "2026-10-09T12:00:00Z", summary: "Still the fastest way." }
    ];
    function etag() { return "\"" + entries.map(function (e) { return e.updated; }).join(",").length + "-" + entries.length + "\""; }
    return {
        request: function (req) {
            count++;
            if (retryAfter) return Promise.resolve({ status: 429, headers: { "retry-after": String(retryAfter) }, body: "" });
            if (unauthorized) return Promise.resolve({ status: 401, headers: {}, body: "" });
            if (req.url !== FEED_URL) return Promise.resolve({ status: 404, headers: {}, body: "" });
            var tag = etag();
            if ((req.headers || {})["If-None-Match"] === tag) return Promise.resolve({ status: 304, headers: { etag: tag }, body: "" });
            return Promise.resolve({ status: 200, headers: { etag: tag, "content-type": "application/atom+xml" }, body: atom(entries) });
        },
        requests: function () { return count; },
        unauthorized: function (on) { unauthorized = !!on; },
        throttle: function (s) { retryAfter = s; },
        entries: entries
    };
}

module.exports = {
    template: JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "public", "accounts", "org.example.feeds", "org.example.feeds.json"), "utf8")),
    validateParams: { config: { url: FEED_URL } },
    server: createServer,
    minObjects: 3,
    FEED_URL: FEED_URL,
    atom: atom
};
