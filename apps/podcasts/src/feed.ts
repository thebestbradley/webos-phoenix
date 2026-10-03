// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Podcast feeds: RSS 2.0 with Apple's podcast tags (itunes:author,
// itunes:image, itunes:duration, itunes:summary; the de facto standard,
// https://podcasters.apple.com/support/823-podcast-requirements) and the
// Podcast namespace's guid where there is one, or Atom with enclosure
// links. Only items with an audio or video enclosure are episodes.

export interface FeedEpisode {
    /** The item's guid, else its enclosure URL. */
    guid: string;
    title: string;
    description: string;
    /** ms since the epoch (0 if the feed gives no date). */
    published: number;
    /** Seconds, 0 if unknown. */
    duration: number;
    url: string;
    type: string;
    /** Bytes, 0 if unknown. */
    length: number;
    image?: string;
    link?: string;
}

export interface Feed {
    title: string;
    author: string;
    description: string;
    image?: string;
    link?: string;
    episodes: FeedEpisode[];
}

export class FeedError extends Error {}

/** "1:02:03", "62:03", "3723", "3723.5" -> seconds. */
export function parseDuration(s: string | null | undefined): number {
    const t = (s ?? "").trim();
    if (!t) return 0;
    if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
    const parts = t.split(":").map((x) => Number(x));
    if (parts.some((x) => !isFinite(x))) return 0;
    return Math.round(parts.reduce((acc, x) => acc * 60 + x, 0));
}

function text(el: Element | null | undefined): string {
    return (el?.textContent ?? "").trim();
}

/** Children by local name, whatever the namespace prefix. */
function kids(el: Element, name: string): Element[] {
    return Array.from(el.children).filter((c) => c.localName === name);
}
function kid(el: Element, name: string, ns?: string): Element | undefined {
    return Array.from(el.children).find((c) => c.localName === name && (!ns || c.namespaceURI === ns));
}

const ITUNES = "http://www.itunes.com/dtds/podcast-1.0.dtd";

/** Descriptions are HTML; keep plain text for lists (the app shows it as text). */
export function plainText(html: string): string {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(`<body>${html.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, "$&\n")}</body>`, "text/html");
    return (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
}

function absolute(url: string | null | undefined, base: string): string | undefined {
    if (!url) return undefined;
    try { return new URL(url.trim(), base).href; } catch { return undefined; }
}

function date(s: string): number {
    const t = Date.parse(s);
    return isFinite(t) ? t : 0;
}

const MEDIA = /^(audio|video)\//i;
const MEDIA_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov)(\?|$)/i;

export function parseFeed(xml: string, feedUrl: string): Feed {
    const doc = new DOMParser().parseFromString(xml.replace(/^﻿/, ""), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new FeedError("This address does not lead to a podcast feed.");
    const root = doc.documentElement;
    if (root.localName === "rss" || root.localName === "RDF") {
        const ch = kids(root, "channel")[0];
        if (!ch) throw new FeedError("This feed has no channel.");
        const itunesImage = kid(ch, "image", ITUNES)?.getAttribute("href");
        const rssImage = text(kid(ch, "image")?.getElementsByTagName("url")[0]);
        const items = (root.localName === "RDF" ? kids(root, "item") : kids(ch, "item"));
        const episodes: FeedEpisode[] = [];
        for (const it of items) {
            const enc = kids(it, "enclosure").find((e) => MEDIA.test(e.getAttribute("type") ?? "") || MEDIA_EXT.test(e.getAttribute("url") ?? ""));
            const media = enc ?? Array.from(it.getElementsByTagName("*")).find((e) => e.localName === "content" && MEDIA.test(e.getAttribute("type") ?? ""));
            const url = absolute(media?.getAttribute("url"), feedUrl);
            if (!url) continue;
            const desc = text(kid(it, "encoded")) || text(kid(it, "description")) || text(kid(it, "summary", ITUNES));
            episodes.push({
                guid: text(kid(it, "guid")) || url,
                title: text(kid(it, "title")) || "Untitled episode",
                description: plainText(desc),
                published: date(text(kid(it, "pubDate")) || text(kid(it, "date"))),
                duration: parseDuration(text(kid(it, "duration", ITUNES))),
                url,
                type: media?.getAttribute("type") || "audio/mpeg",
                length: Number(media?.getAttribute("length") || media?.getAttribute("fileSize") || 0) || 0,
                image: absolute(kid(it, "image", ITUNES)?.getAttribute("href"), feedUrl),
                link: absolute(text(kid(it, "link")), feedUrl),
            });
        }
        return {
            title: text(kid(ch, "title")) || "Untitled podcast",
            author: text(kid(ch, "author", ITUNES)) || text(kid(ch, "managingEditor")) || text(kid(ch, "creator")),
            description: plainText(text(kid(ch, "summary", ITUNES)) || text(kid(ch, "description"))),
            image: absolute(itunesImage || rssImage, feedUrl),
            link: absolute(text(kid(ch, "link")), feedUrl),
            episodes: sortEpisodes(episodes),
        };
    }
    if (root.localName === "feed") {
        // Atom (RFC 4287): enclosures are link rel="enclosure".
        const episodes: FeedEpisode[] = [];
        for (const e of kids(root, "entry")) {
            const enc = kids(e, "link").find((l) => l.getAttribute("rel") === "enclosure");
            const url = absolute(enc?.getAttribute("href"), feedUrl);
            if (!url) continue;
            episodes.push({
                guid: text(kid(e, "id")) || url,
                title: text(kid(e, "title")) || "Untitled episode",
                description: plainText(text(kid(e, "content")) || text(kid(e, "summary"))),
                published: date(text(kid(e, "published")) || text(kid(e, "updated"))),
                duration: parseDuration(text(kid(e, "duration", ITUNES))),
                url,
                type: enc?.getAttribute("type") || "audio/mpeg",
                length: Number(enc?.getAttribute("length") || 0) || 0,
                link: absolute(kids(e, "link").find((l) => (l.getAttribute("rel") ?? "alternate") === "alternate")?.getAttribute("href"), feedUrl),
            });
        }
        const author = kid(root, "author");
        return {
            title: text(kid(root, "title")) || "Untitled podcast",
            author: text(author ? kid(author, "name") : undefined),
            description: plainText(text(kid(root, "subtitle"))),
            image: absolute(text(kid(root, "logo")) || text(kid(root, "icon")) || kid(root, "image", ITUNES)?.getAttribute("href"), feedUrl),
            link: absolute(kids(root, "link").find((l) => (l.getAttribute("rel") ?? "alternate") === "alternate")?.getAttribute("href"), feedUrl),
            episodes: sortEpisodes(episodes),
        };
    }
    throw new FeedError("This address does not lead to a podcast feed.");
}

/** Newest first; undated ones keep the feed's order after the dated ones. */
export function sortEpisodes(eps: FeedEpisode[]): FeedEpisode[] {
    return eps.map((e, i) => ({ e, i })).sort((a, b) => (b.e.published - a.e.published) || (a.i - b.i)).map((x) => x.e);
}

/** A feed address from what someone typed: "example.com/feed" -> "https://example.com/feed"; itpc:, pcast:, feed: schemes too. */
export function normaliseFeedUrl(input: string): string | null {
    let s = input.trim();
    if (!s) return null;
    s = s.replace(/^(itpc|pcast|feed|podcast):\/\//i, "https://").replace(/^feed:/i, "");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch {
        return null;
    }
}
