// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// OPML 2.0 (http://opml.org/spec2.opml) subscription lists, the format
// every podcast app imports and exports: outline elements with
// type="rss", text/title and xmlUrl, possibly nested in folders.

export interface OpmlFeed {
    title: string;
    xmlUrl: string;
    htmlUrl?: string;
}

export function parseOpml(xml: string): OpmlFeed[] {
    const doc = new DOMParser().parseFromString(xml.replace(/^﻿/, ""), "application/xml");
    if (doc.getElementsByTagName("parsererror").length || doc.documentElement.localName !== "opml")
        throw new Error("This is not an OPML file.");
    const seen = new Set<string>();
    const out: OpmlFeed[] = [];
    for (const o of Array.from(doc.getElementsByTagName("outline"))) {
        const url = (o.getAttribute("xmlUrl") ?? o.getAttribute("xmlurl") ?? o.getAttribute("url") ?? "").trim();
        if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        out.push({ title: o.getAttribute("title") ?? o.getAttribute("text") ?? url, xmlUrl: url, htmlUrl: o.getAttribute("htmlUrl") ?? undefined });
    }
    return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toOpml(feeds: OpmlFeed[], now = new Date()): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Podcasts on webOS Phoenix</title>
    <dateCreated>${now.toUTCString()}</dateCreated>
  </head>
  <body>
${feeds.map((f) => `    <outline type="rss" text="${esc(f.title)}" title="${esc(f.title)}" xmlUrl="${esc(f.xmlUrl)}"${f.htmlUrl ? ` htmlUrl="${esc(f.htmlUrl)}"` : ""}/>`).join("\n")}
  </body>
</opml>
`;
}
