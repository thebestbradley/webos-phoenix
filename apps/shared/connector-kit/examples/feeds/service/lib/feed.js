// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// RSS 2.0 (https://www.rssboard.org/rss-specification) and Atom (RFC 4287)
// read just enough for the hello-world connector: the feed's title and
// link, and each entry's id, title, link, summary and dates. No DOM is
// needed (a device's Node.js has none), so the elements are found by name.

"use strict";

var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0" };

function decode(s) {
    return String(s || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, function (m, c) { return c; })
        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
            if (e.charAt(0) === "#") {
                var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
                return isNaN(n) ? m : String.fromCodePoint(n);
            }
            return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
        });
}

// Text without markup (a summary is often HTML).
function plain(s) {
    return decode(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, function (m, c) { return c; }))
        .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// The text of the first <name> (with or without a prefix) in xml.
function child(xml, name) {
    var re = new RegExp("<(?:[A-Za-z0-9_-]+:)?" + name + "(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?" + name + "\\s*>)", "i");
    var m = re.exec(xml);
    return m ? { attrs: m[1] || "", text: m[2] || "" } : null;
}

function attr(attrs, name) {
    var m = new RegExp("\\s" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i").exec(attrs || "");
    return m ? decode(m[2] !== undefined ? m[2] : m[3]) : "";
}

function blocks(xml, name) {
    var re = new RegExp("<" + name + "(\\s[^>]*)?>([\\s\\S]*?)</" + name + "\\s*>", "gi"), out = [], m;
    while ((m = re.exec(xml))) out.push(m[2]);
    return out;
}

function time(s) {
    var t = Date.parse(String(s || "").trim());
    return isNaN(t) ? 0 : t;
}

// Atom's link: rel="alternate" (or none) wins.
function atomLink(xml) {
    var re = /<link(\s[^>]*)\/?>/gi, m, first = "";
    while ((m = re.exec(xml))) {
        var rel = attr(m[1], "rel"), href = attr(m[1], "href");
        if (!first) first = href;
        if (!rel || rel === "alternate") return href;
    }
    return first;
}

// -> {title, link, entries: [{id, title, link, summary, published, updated}]}; throws when it is no feed.
function parse(text) {
    var xml = String(text || "");
    if (/<rss[\s>]/i.test(xml) || /<rdf:RDF[\s>]/i.test(xml)) {
        var channel = child(xml, "channel");
        var head = channel ? channel.text.split(/<item[\s>]/i)[0] : xml;
        return {
            title: plain((child(head, "title") || {}).text) || "Feed",
            link: plain((child(head, "link") || {}).text),
            entries: blocks(xml, "item").map(function (it) {
                var link = plain((child(it, "link") || {}).text);
                var guid = plain((child(it, "guid") || {}).text);
                var date = time((child(it, "pubDate") || child(it, "date") || {}).text);
                return { id: guid || link || plain((child(it, "title") || {}).text), title: plain((child(it, "title") || {}).text),
                         link: link, summary: plain((child(it, "description") || {}).text).slice(0, 500), published: date, updated: date };
            })
        };
    }
    if (/<feed[\s>]/i.test(xml)) {
        var top = xml.split(/<entry[\s>]/i)[0];
        return {
            title: plain((child(top, "title") || {}).text) || "Feed",
            link: atomLink(top),
            entries: blocks(xml, "entry").map(function (e) {
                var updated = time((child(e, "updated") || {}).text);
                var published = time((child(e, "published") || {}).text) || updated;
                return { id: plain((child(e, "id") || {}).text) || atomLink(e), title: plain((child(e, "title") || {}).text),
                         link: atomLink(e), summary: plain((child(e, "summary") || child(e, "content") || {}).text).slice(0, 500),
                         published: published, updated: updated || published };
            })
        };
    }
    var err = new Error("Not an RSS or Atom feed");
    err.errorCode = "400_BAD_REQUEST";
    throw err;
}

module.exports = { parse: parse, plain: plain };
