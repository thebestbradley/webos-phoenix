// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { itunesSearchUrl, parseItunes, parsePodcastIndex, podcastIndexHeaders, podcastIndexSearchUrl, sha1Hex } from "./directory";
import { normaliseFeedUrl, parseDuration, parseFeed, plainText, FeedError } from "./feed";
import { parseOpml, toOpml } from "./opml";
import { activityDate, episodeFileName, EPISODE_KIND, mergeEpisodes, slug, type Episode } from "./store";
import { durationText, episodeDate, nextSpeed, sleepDue, sleepRemaining, speedLabel, startSleep } from "./timing";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Harbor Radio</title>
  <link>https://harbor.example/</link>
  <description>Plain description</description>
  <itunes:summary>Tales from the &lt;b&gt;harbor&lt;/b&gt;.</itunes:summary>
  <itunes:author>Ada Keeper</itunes:author>
  <itunes:image href="/art.jpg"/>
  <item>
    <title>Episode 1</title>
    <guid>ep-1</guid>
    <pubDate>Mon, 07 Sep 2026 09:00:00 GMT</pubDate>
    <itunes:duration>1:02:03</itunes:duration>
    <content:encoded><![CDATA[<p>First <i>one</i>.</p><p>Second paragraph.</p>]]></content:encoded>
    <enclosure url="https://cdn.example/ep1.mp3" length="1234" type="audio/mpeg"/>
  </item>
  <item>
    <title>Not an episode</title>
    <link>https://harbor.example/news</link>
  </item>
  <item>
    <title>Episode 2</title>
    <pubDate>Mon, 14 Sep 2026 09:00:00 GMT</pubDate>
    <itunes:duration>2700</itunes:duration>
    <description>Short</description>
    <enclosure url="ep2.m4a" type=""/>
  </item>
</channel>
</rss>`;

describe("feeds", () => {
    it("reads an RSS podcast feed with Apple's podcast tags", () => {
        const f = parseFeed(RSS, "https://harbor.example/feed.xml");
        expect(f).toMatchObject({ title: "Harbor Radio", author: "Ada Keeper", description: "Tales from the harbor.", image: "https://harbor.example/art.jpg" });
        expect(f.episodes.map((e) => e.title)).toEqual(["Episode 2", "Episode 1"]);
        const [e2, e1] = f.episodes;
        expect(e1).toMatchObject({ guid: "ep-1", duration: 3723, url: "https://cdn.example/ep1.mp3", length: 1234, type: "audio/mpeg" });
        expect(e1.description).toBe("First one.\nSecond paragraph.");
        expect(e1.published).toBe(Date.UTC(2026, 8, 7, 9));
        expect(e2).toMatchObject({ guid: "https://harbor.example/ep2.m4a", url: "https://harbor.example/ep2.m4a", duration: 2700, type: "audio/mpeg" });
    });

    it("reads an Atom feed with enclosure links", () => {
        const f = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Cast</title><author><name>Ben</name></author><logo>logo.png</logo>
            <entry><id>urn:1</id><title>One</title><published>2026-09-01T10:00:00Z</published><summary>Hi</summary>
            <link rel="alternate" href="https://a.example/1"/><link rel="enclosure" href="https://a.example/1.ogg" type="audio/ogg" length="99"/></entry>
            <entry><id>urn:2</id><title>No audio</title></entry></feed>`, "https://a.example/feed");
        expect(f).toMatchObject({ title: "Atom Cast", author: "Ben", image: "https://a.example/logo.png" });
        expect(f.episodes).toHaveLength(1);
        expect(f.episodes[0]).toMatchObject({ guid: "urn:1", url: "https://a.example/1.ogg", type: "audio/ogg", length: 99, link: "https://a.example/1" });
    });

    it("says when something is not a feed", () => {
        expect(() => parseFeed("<html><body>hi</body></html>", "https://x/")).toThrow(FeedError);
        expect(() => parseFeed("not xml <", "https://x/")).toThrow(FeedError);
    });

    it("reads durations and cleans descriptions", () => {
        expect(parseDuration("45:10")).toBe(2710);
        expect(parseDuration("90")).toBe(90);
        expect(parseDuration("12.6")).toBe(13);
        expect(parseDuration("")).toBe(0);
        expect(parseDuration("soon")).toBe(0);
        expect(plainText("<p>A&amp;B</p><script>x</script>")).toBe("A&B\nx");
    });

    it("turns what someone typed into a feed address", () => {
        expect(normaliseFeedUrl("harbor.example/feed")).toBe("https://harbor.example/feed");
        expect(normaliseFeedUrl("itpc://harbor.example/feed")).toBe("https://harbor.example/feed");
        expect(normaliseFeedUrl("http://harbor.example/feed")).toBe("http://harbor.example/feed");
        expect(normaliseFeedUrl("ftp://x/y")).toBeNull();
        expect(normaliseFeedUrl("   ")).toBeNull();
    });
});

describe("OPML", () => {
    it("reads subscriptions, nested in folders, once each", () => {
        const feeds = parseOpml(`<?xml version="1.0"?><opml version="1.0"><body>
            <outline text="News"><outline type="rss" text="One &amp; Two" xmlUrl="https://1.example/rss"/></outline>
            <outline type="rss" title="Dup" xmlUrl="https://1.example/rss"/><outline text="No URL"/><outline type="rss" text="Two" xmlUrl="http://2.example/rss" htmlUrl="http://2.example/"/>
            </body></opml>`);
        expect(feeds).toEqual([{ title: "One & Two", xmlUrl: "https://1.example/rss", htmlUrl: undefined }, { title: "Two", xmlUrl: "http://2.example/rss", htmlUrl: "http://2.example/" }]);
        expect(() => parseOpml("<rss/>")).toThrow(/not an OPML/);
    });

    it("writes what it reads", () => {
        const feeds = [{ title: 'Quotes "&" <tags>', xmlUrl: "https://q.example/rss?a=1&b=2" }];
        const xml = toOpml(feeds, new Date(Date.UTC(2026, 8, 28)));
        expect(xml).toContain("<dateCreated>Mon, 28 Sep 2026 00:00:00 GMT</dateCreated>");
        expect(parseOpml(xml)).toEqual([{ ...feeds[0], htmlUrl: undefined }]);
    });
});

describe("directory search", () => {
    it("builds Apple's search address and reads its answer", () => {
        expect(itunesSearchUrl(" luna bus ")).toBe("https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=luna%20bus");
        expect(parseItunes(JSON.stringify({ results: [{ collectionName: "A", artistName: "B", feedUrl: "https://a/rss" }, { collectionName: "No feed" }] })))
            .toEqual([{ title: "A", author: "B", feedUrl: "https://a/rss", source: "itunes" }]);
    });

    it("signs Podcast Index requests (SHA-1 of key, secret and time)", () => {
        expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
        expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
        expect(sha1Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
        expect(sha1Hex("ü")).toBe("94a759fd37735430753c7b6b80684306d80ea16e");
        const h = podcastIndexHeaders({ key: "KEY", secret: "SECRET" }, 1_700_000_000_000);
        expect(h).toMatchObject({ "X-Auth-Key": "KEY", "X-Auth-Date": "1700000000", Authorization: sha1Hex("KEYSECRET1700000000") });
        expect(h["User-Agent"]).toMatch(/^webOSPhoenixPodcasts\//);
        expect(podcastIndexSearchUrl("a b")).toBe("https://api.podcastindex.org/api/1.0/search/byterm?max=25&q=a%20b");
        expect(parsePodcastIndex(JSON.stringify({ feeds: [{ title: "T", author: "", ownerName: "O", url: "https://t/rss" }] })))
            .toEqual([{ title: "T", author: "O", feedUrl: "https://t/rss", source: "podcastindex" }]);
    });
});

describe("episodes", () => {
    const feedEp = (guid: string, published: number) => ({ guid, title: guid, description: "", published, duration: 60, url: `https://x/${guid}.mp3`, type: "audio/mpeg", length: 0 });
    const stored = (guid: string, extra: Partial<Episode> = {}): Episode => ({
        _id: "id-" + guid, _kind: EPISODE_KIND, podcastId: "p", guid, title: guid, description: "", published: 0, duration: 60,
        url: "", type: "audio/mpeg", length: 0, position: 0, played: false, ...extra,
    });

    it("marks the back catalogue played when subscribing, all but the newest", () => {
        const m = mergeEpisodes("p", [feedEp("c", 3), feedEp("b", 2), feedEp("a", 1)], [], true);
        expect(m.put.map((e) => [e.guid, e.played])).toEqual([["c", false], ["b", true], ["a", true]]);
        expect(m.added).toBe(0);
    });

    it("keeps where the listener was on a refresh, counts new episodes, drops gone ones unless kept", () => {
        const m = mergeEpisodes("p", [feedEp("d", 4), feedEp("c", 3)], [
            stored("c", { position: 30, file: "/media/internal/podcasts/p/c.mp3" }),
            stored("b"), stored("a", { position: 10 }), stored("z", { file: "/f.mp3" }),
        ], false);
        expect(m.added).toBe(1);
        expect(m.put.find((e) => e.guid === "c")).toMatchObject({ _id: "id-c", position: 30, file: "/media/internal/podcasts/p/c.mp3" });
        expect(m.put.find((e) => e.guid === "d")).toMatchObject({ played: false, position: 0 });
        expect(m.del).toEqual(["id-b"]);
    });

    it("names downloads", () => {
        expect(slug("Harbor Radio: Ça va?")).toBe("harbor-radio-ca-va");
        expect(slug("!!!")).toBe("podcast");
        expect(episodeFileName({ title: "Ep. 1 — Hello", url: "https://x/a/b.m4a?token=1", type: "audio/mpeg", published: Date.UTC(2026, 8, 7) })).toBe("2026-09-07-ep-1-hello.m4a");
        expect(episodeFileName({ title: "Live", url: "https://x/stream", type: "audio/ogg", published: 0 })).toBe("live.ogg");
        expect(activityDate(Date.UTC(2026, 8, 28, 14, 5, 9, 500))).toBe("2026-09-28 14:05:09Z");
    });
});

describe("speed and sleep timer", () => {
    it("steps through the speeds", () => {
        expect(nextSpeed(1)).toBe(1.25);
        expect(nextSpeed(2)).toBe(0.75);
        expect(nextSpeed(0.75)).toBe(1);
        expect(nextSpeed(3)).toBe(1);
        expect(speedLabel(1.25)).toBe("1.25×");
        expect(speedLabel(1)).toBe("1×");
    });

    it("counts down and knows when to stop", () => {
        const t = startSleep(15, 0)!;
        expect(sleepRemaining(t, 60_000)).toBe("14:00");
        expect(sleepDue(t, 899_999)).toBe(false);
        expect(sleepDue(t, 900_000)).toBe(true);
        expect(startSleep(0)).toBeNull();
        const end = startSleep("end")!;
        expect(sleepRemaining(end)).toBe("End");
        expect(sleepDue(end)).toBe(false);
    });

    it("labels dates and lengths", () => {
        const now = Date.UTC(2026, 8, 28, 12);
        expect(episodeDate(Date.UTC(2026, 8, 7, 12), now)).toBe("Sep 7");
        expect(episodeDate(Date.UTC(2025, 0, 2, 12), now)).toBe("Jan 2, 2025");
        expect(durationText(3900)).toBe("1 h 5 min");
        expect(durationText(2700, 600)).toBe("35 min left");
        expect(durationText(0)).toBe("");
    });
});
