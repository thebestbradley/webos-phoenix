// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Finding podcasts by name.
//
//   Apple's iTunes Search API (no key): GET
//       https://itunes.apple.com/search?media=podcast&entity=podcast&term=...
//       -> {resultCount, results: [{collectionName, artistName, feedUrl, ...}]}.
//       Terms (https://performance-partners.apple.com/search-api): about 20
//       calls a minute; results should be cached; the artwork, previews and
//       other "promotional content" may only be shown to promote the item
//       with a link to it. Podcasts' search therefore shows only each
//       podcast's name and author, links to the feed the podcaster
//       publishes (the art in the app comes from that feed), searches only
//       when asked, and keeps answers for an hour.
//   Podcast Index (https://podcastindex-org.github.io/docs-api/): free, but
//       every call needs an API key and secret from api.podcastindex.org:
//       X-Auth-Key, X-Auth-Date (Unix seconds) and Authorization =
//       sha1(key + secret + date) in hex, and a User-Agent naming the app.
//       Used when someone has entered a key and secret in Preferences;
//       Phoenix does not ship a key.

import { httpText } from "@phoenix/luna";

export interface DirectoryResult {
    title: string;
    author: string;
    feedUrl: string;
    /** Where the result came from, for the credit line. */
    source: "itunes" | "podcastindex";
}

export interface PodcastIndexKey {
    key: string;
    secret: string;
}

export const USER_AGENT = "webOSPhoenixPodcasts/0.1 (+https://github.com/thebestbradley/webos-phoenix)";
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; results: DirectoryResult[] }>();

export function itunesSearchUrl(term: string, limit = 25): string {
    return `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=${limit}&term=${encodeURIComponent(term.trim())}`;
}

export function parseItunes(json: string): DirectoryResult[] {
    const r = JSON.parse(json) as { results?: { collectionName?: string; trackName?: string; artistName?: string; feedUrl?: string }[] };
    return (r.results ?? []).filter((x) => x.feedUrl).map((x) => ({
        title: x.collectionName || x.trackName || x.feedUrl!, author: x.artistName ?? "", feedUrl: x.feedUrl!, source: "itunes" as const,
    }));
}

export function podcastIndexSearchUrl(term: string, max = 25): string {
    return `https://api.podcastindex.org/api/1.0/search/byterm?max=${max}&q=${encodeURIComponent(term.trim())}`;
}

export function parsePodcastIndex(json: string): DirectoryResult[] {
    const r = JSON.parse(json) as { feeds?: { title?: string; author?: string; ownerName?: string; url?: string }[] };
    return (r.feeds ?? []).filter((f) => f.url).map((f) => ({
        title: f.title || f.url!, author: f.author || f.ownerName || "", feedUrl: f.url!, source: "podcastindex" as const,
    }));
}

// ---- SHA-1 (FIPS 180-4), for the Podcast Index signature; crypto.subtle
// needs a secure context, which an app page on a device may not be. ----------

export function sha1Hex(message: string): string {
    const bytes = new TextEncoder().encode(message);
    const words: number[] = [];
    for (let i = 0; i < bytes.length; ++i) words[i >> 2] = (words[i >> 2] ?? 0) | (bytes[i] << (24 - (i % 4) * 8));
    const bitLen = bytes.length * 8;
    words[bitLen >> 5] = (words[bitLen >> 5] ?? 0) | (0x80 << (24 - (bitLen % 32)));
    const last = (((bitLen + 64) >> 9) << 4) + 15;
    for (let i = 0; i <= last; ++i) words[i] ??= 0;
    words[last] = bitLen;
    let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const w = new Array<number>(80);
    const rol = (x: number, n: number) => (x << n) | (x >>> (32 - n));
    for (let i = 0; i < words.length; i += 16) {
        for (let t = 0; t < 80; ++t) w[t] = t < 16 ? words[i + t] | 0 : rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
        let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
        for (let t = 0; t < 80; ++t) {
            const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
            const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
            const tmp = (rol(a, 5) + f + e + k + w[t]) | 0;
            e = d; d = c; c = rol(b, 30); b = a; a = tmp;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}

export function podcastIndexHeaders(k: PodcastIndexKey, now = Date.now()): Record<string, string> {
    const date = String(Math.floor(now / 1000));
    return {
        "User-Agent": USER_AGENT,
        "X-Auth-Key": k.key,
        "X-Auth-Date": date,
        Authorization: sha1Hex(k.key + k.secret + date),
    };
}

/** Search the Podcast Index when there is a key, else Apple's directory. */
export async function searchDirectory(term: string, key?: PodcastIndexKey | null): Promise<DirectoryResult[]> {
    const q = term.trim();
    if (!q) return [];
    const usePi = !!(key?.key && key.secret);
    const id = `${usePi ? "pi" : "it"}:${q.toLowerCase()}`;
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.results;
    const results = usePi
        ? parsePodcastIndex(await httpText(podcastIndexSearchUrl(q), podcastIndexHeaders(key!)))
        : parseItunes(await httpText(itunesSearchUrl(q)));
    cache.set(id, { at: Date.now(), results });
    return results;
}
