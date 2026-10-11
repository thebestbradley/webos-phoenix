// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Quick facts (lib/commands-facts.js, lib/lang/en-facts.js): the offline
// dictionary (data/dictionary.json, from WordNet), spelling, coins, dice,
// random numbers, Wikipedia's summaries and the news feeds' headlines.

import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };
const parse = (t: string) => grammar.parse(t, { lang: "en", now: NOW });
afterEach(() => { vi.restoreAllMocks(); });

const RSS = `<?xml version="1.0"?><rss><channel><title>Harbor News</title>
<item><title>Ferry service resumes</title><link>https://news.example/ferry</link><pubDate>Sun, 11 Oct 2026 08:00:00 GMT</pubDate></item>
<item><title><![CDATA[Lighthouse &amp; museum reopen]]></title><link>https://news.example/lighthouse</link><pubDate>Sun, 11 Oct 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Tech</title>
<entry><title>New phone ships</title><link href="https://tech.example/phone"/><updated>2026-10-11T10:00:00Z</updated></entry></feed>`;

describe("the words", () => {
    it("definitions and spelling", () => {
        expect(parse("define serendipity")).toEqual({ command: "define", args: { word: "serendipity" } });
        expect(parse("what does ephemeral mean")).toEqual({ command: "define", args: { word: "ephemeral" } });
        expect(parse("what's the meaning of the word ubiquitous")?.args).toEqual({ word: "ubiquitous" });
        expect(parse("what is the meaning of life")?.command).not.toBe("define");
        expect(parse("how do you spell rhythm")).toEqual({ command: "spell", args: { word: "rhythm" } });
        expect(parse("how is accommodate spelled")?.args).toEqual({ word: "accommodate" });
        expect(parse("how is it going")?.command).not.toBe("spell");
    });
    it("coins, dice and numbers", () => {
        expect(parse("flip a coin")).toEqual({ command: "coin", args: {} });
        expect(parse("heads or tails")?.command).toBe("coin");
        expect(parse("roll a die")?.args).toEqual({ count: 1, sides: 6 });
        expect(parse("roll two dice")?.args).toEqual({ count: 2, sides: 6 });
        expect(parse("roll a d20")?.args).toEqual({ count: 1, sides: 20 });
        expect(parse("pick a random number between 1 and 50")?.args).toEqual({ min: 1, max: 50 });
        expect(parse("random number")?.args).toEqual({});
    });
    it("Wikipedia and the news, and not the questions a model answers", () => {
        expect(parse("look up Ada Lovelace on Wikipedia")).toEqual({ command: "wikipedia", args: { topic: "Ada Lovelace" } });
        expect(parse("what does wikipedia say about the Eiffel Tower")?.args).toEqual({ topic: "Eiffel Tower" });
        expect(parse("what's the news")).toEqual({ command: "news", args: {} });
        expect(parse("read me the headlines")?.command).toBe("news");
        expect(parse("who was Ada Lovelace")).toBeNull();
        expect(parse("why is the sky blue")).toBeNull();
    });
});

describe("the dictionary on the phone", () => {
    it("defines a word, and finds a form of it", async () => {
        const d = device();
        expect((await d.ask("define ephemeral")).text).toBe("Ephemeral, adjective: lasting a very short time. Also, as a noun: anything short-lived, as an insect that lives only for a day in its winged form.");
        const ran = await d.ask("what does ran mean");
        expect(ran.text).toMatch(/^Run \(ran\), (?:noun|verb): /);
        expect((await d.ask("define cats")).text).toMatch(/^Cat \(cats\), noun: feline mammal/);
    });
    it("says when it does not have a word, and offers the web", async () => {
        const d = device();
        const m = await d.ask("define blorfle");
        expect(m.text).toBe("I don't have “blorfle” in the dictionary on the phone.");
        expect(m.choices.map((c: { id: string }) => c.id)).toContain("web");
    });
    it("spells", async () => {
        const d = device();
        expect((await d.ask("how do you spell rhythm")).text).toBe("Rhythm is spelled R-H-Y-T-H-M.");
    });
});

describe("chance", () => {
    it("flips, rolls and picks", async () => {
        const d = device();
        vi.spyOn(Math, "random").mockReturnValue(0.2);
        expect((await d.ask("flip a coin")).text).toBe("Heads.");
        expect((await d.ask("roll two dice")).text).toBe("You rolled 2 and 2: 4 in all.");
        expect((await d.ask("roll a d20")).text).toBe("You rolled 5 (d20).");
        expect((await d.ask("pick a random number between 1 and 50")).text).toBe("11. (A random number from 1 to 50.)");
    });
});

describe("Wikipedia", () => {
    it("reads an article's summary, saying where it is from, with the article to open", async () => {
        const d = device({ http: (url: string) => /wikipedia\.org\/api\/rest_v1\/page\/summary\/Ada_Lovelace/.test(url)
            ? { status: 200, body: JSON.stringify({ type: "standard", title: "Ada Lovelace", description: "English mathematician (1815–1852)",
                                                     extract: "Augusta Ada King, Countess of Lovelace was an English mathematician. She is known for her work on the Analytical Engine. More follows. And more.",
                                                     content_urls: { mobile: { page: "https://en.m.wikipedia.org/wiki/Ada_Lovelace" } } }) } : null });
        const m = await d.ask("look up Ada Lovelace on Wikipedia");
        expect(m.text).toBe("From Wikipedia, Ada Lovelace: Augusta Ada King, Countess of Lovelace was an English mathematician. She is known for her work on the Analytical Engine. More follows.");
        expect(m.data.attachments ?? m.attachments).toBeTruthy();
        expect(d.requests.some((u: string) => u.startsWith("https://en.wikipedia.org/api/rest_v1/page/summary/Ada_Lovelace"))).toBe(true);
    });
    it("says when there is no article", async () => {
        const m = await device().ask("look up Blorfle Quux on Wikipedia");
        expect(m.text).toBe("Wikipedia has no article called “Blorfle Quux”.");
    });
});

describe("the news", () => {
    it("reads the newest headlines of the feeds, each a card", async () => {
        const d = device({ http: (url: string) => url === "https://news.example/rss" ? { status: 200, body: RSS }
            : url === "https://tech.example/atom" ? { status: 200, body: ATOM } : null });
        expect((await d.svc.setNewsFeeds({ feeds: [{ title: "Harbor News", url: "https://news.example/rss" }, { title: "Tech", url: "https://tech.example/atom" },
                                                    { title: "Bad", url: "javascript:alert(1)" }] })).feeds).toHaveLength(2);
        const m = await d.ask("what's the news");
        expect(m.text).toBe("Here are the latest headlines: New phone ships. Lighthouse & museum reopen. Ferry service resumes.");
    });
    it("starts with feeds a new phone has, and says when none answer", async () => {
        const d = device();
        expect((await d.svc.newsFeeds({})).feeds.map((f: { title: string }) => f.title)).toEqual(["BBC News", "NPR News"]);
        expect((await d.ask("read me the headlines")).text).toBe("I couldn't get the news from your feeds right now.");
    });
});
