// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Quick facts (docs/AI-AND-MCP.md, "Everyday features"):
//
//   define        "define serendipity", "what does ephemeral mean": the
//                 offline dictionary, data/dictionary.json, made from
//                 Princeton WordNet 3.0 by tools/make-dictionary.py (its
//                 licence: data/WORDNET-LICENSE); "ran" is found as "run"
//   spell         "how do you spell necessary": letter by letter
//   coin          "flip a coin"
//   dice          "roll a die", "roll two dice", "roll a d20"
//   randomNumber  "pick a random number between 1 and 50"
//   wikipedia     "look up Ada Lovelace on Wikipedia", "what does Wikipedia
//                 say about the Eiffel Tower": the article's summary
//                 (Wikipedia's REST API, page/summary), said with where it is
//                 from; its text is CC BY-SA 4.0, so the answer names
//                 Wikipedia and links the article
//   news          "what's the news", "read me the headlines": the newest
//                 headlines of the user's news feeds (RSS or Atom; Settings >
//                 Assistant > News, the service's newsFeeds / setNewsFeeds),
//                 each a card opening the story
//
// The service's methods: newsFeeds {} -> {feeds: [{title, url}]},
// setNewsFeeds {feeds} (Settings).

"use strict";

var FEEDS_KEY = "assistant:newsFeeds";
// The feeds a new phone starts with (OPEN-QUESTIONS: the owner's to choose).
var DEFAULT_FEEDS = [{ title: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" },
                     { title: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" }];
var MAX_FEEDS = 10, HEADLINES = 5;
var BROWSER = "com.palm.app.browser";
var WIKI_AGENT = "webOS-Phoenix-Assistant/0.1 (https://github.com/thebestbradley/webos-phoenix)";

var COMMANDS = [
    { id: "define", title: "Definitions", risk: "read", whenLocked: true,
      description: "Say what an English word means, from the phone's own dictionary.",
      parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
      examples: ["what's the meaning of the word ubiquitous", "give me the definition of quixotic", "what is a synonym for happy"] },
    { id: "spell", title: "Spelling", risk: "read", whenLocked: true,
      description: "Spell a word letter by letter.",
      parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
      examples: ["how is rhythm spelled", "can you spell accommodate for me"] },
    { id: "coin", title: "Flipping a coin", risk: "read", whenLocked: true, description: "Flip a coin: heads or tails.",
      parameters: { type: "object", properties: {} }, examples: ["heads or tails", "toss a coin for me"] },
    { id: "dice", title: "Rolling dice", risk: "read", whenLocked: true, description: "Roll dice: how many, and how many sides (6 unless said).",
      parameters: { type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 10 }, sides: { type: "integer", minimum: 2, maximum: 100 } } },
      examples: ["throw a die", "roll 3 dice", "roll a twenty sided die"] },
    { id: "randomNumber", title: "Random numbers", risk: "read", whenLocked: true, description: "Pick a random whole number between two numbers (1 to 100 unless said).",
      parameters: { type: "object", properties: { min: { type: "integer" }, max: { type: "integer" } } },
      examples: ["give me a number from 1 to 6", "choose a random number"] },
    { id: "wikipedia", title: "Wikipedia", risk: "read",
      description: "Read the summary of a Wikipedia article on a person, place or thing.",
      parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
      examples: ["look up the Roman Empire on Wikipedia", "what does Wikipedia say about Alan Turing"] },
    { id: "news", title: "News", risk: "read",
      description: "Read the latest headlines from the user's news feeds.",
      parameters: { type: "object", properties: {} },
      examples: ["what's happening in the world", "give me my news briefing", "any headlines today"] }
];

function clean(w) { return String(w || "").toLowerCase().replace(/[^a-z' -]+/g, "").replace(/^['\s-]+|['\s-]+$/g, "").trim(); }

// WordNet's own rules for a word's base form (morphy: the suffixes it takes off).
var SUFFIXES = { n: [["s", ""], ["ses", "s"], ["xes", "x"], ["zes", "z"], ["ches", "ch"], ["shes", "sh"], ["men", "man"], ["ies", "y"]],
                 v: [["s", ""], ["ies", "y"], ["es", "e"], ["es", ""], ["ed", "e"], ["ed", ""], ["ing", "e"], ["ing", ""]],
                 a: [["er", ""], ["est", ""], ["er", "e"], ["est", "e"]] };

module.exports = function (h) {
    var dict = null;
    // Loaded the first time a word is asked (about 6 MB).
    function dictionary() {
        if (!dict) dict = require("../data/dictionary.json");
        return dict;
    }
    function lookup(word) {
        var d = dictionary(), w = clean(word).replace(/\s+/g, "");
        if (!w) return null;
        if (d.words[w]) return { word: w, senses: d.words[w] };
        if (d.forms[w] && d.words[d.forms[w]]) return { word: d.forms[w], senses: d.words[d.forms[w]], form: w };
        var keys = Object.keys(SUFFIXES);
        for (var k = 0; k < keys.length; ++k) {
            var rules = SUFFIXES[keys[k]];
            for (var i = 0; i < rules.length; ++i) {
                var end = rules[i][0];
                if (w.length > end.length + 1 && w.slice(-end.length) === end) {
                    var base = w.slice(0, -end.length) + rules[i][1];
                    if (d.words[base]) return { word: base, senses: d.words[base], form: w };
                }
            }
        }
        return null;
    }
    function rnd(env) { return (env.random || Math.random)(); }

    function define(args, env) {
        var say = env.lang.say, found = lookup(args.word);
        if (!found) return Promise.resolve({ text: say.noDefinition(String(args.word || "").trim()), offerWeb: true });
        return Promise.resolve({ text: say.definition(found.word, found.senses, found.form || ""), data: { word: found.word, senses: found.senses.length } });
    }
    function spell(args, env) {
        var w = String(args.word || "").trim().replace(/[^A-Za-z' -]+/g, "");
        if (!w) return Promise.resolve({ text: env.lang.say.spellWhat() });
        var known = lookup(w);
        return Promise.resolve({ text: env.lang.say.spelled(w, known ? null : true) });
    }
    function coin(args, env) { return Promise.resolve({ text: env.lang.say.coin(rnd(env) < 0.5) }); }
    function dice(args, env) {
        var n = Math.max(1, Math.min(10, Math.round(Number(args.count) || 1))), sides = Math.max(2, Math.min(100, Math.round(Number(args.sides) || 6)));
        var rolls = [];
        for (var i = 0; i < n; ++i) rolls.push(1 + Math.floor(rnd(env) * sides));
        return Promise.resolve({ text: env.lang.say.rolled(rolls, sides), data: { rolls: rolls } });
    }
    function randomNumber(args, env) {
        var lo = Number.isFinite(Number(args.min)) && args.min !== "" && args.min !== null && args.min !== undefined ? Math.round(Number(args.min)) : 1;
        var hi = Number.isFinite(Number(args.max)) && args.max !== "" && args.max !== null && args.max !== undefined ? Math.round(Number(args.max)) : 100;
        if (hi < lo) { var t = lo; lo = hi; hi = t; }
        var n = lo + Math.floor(rnd(env) * (hi - lo + 1));
        return Promise.resolve({ text: env.lang.say.randomNumber(n, lo, hi), data: { number: n } });
    }

    // ---- Wikipedia ----
    function wikipedia(args, env) {
        var say = env.lang.say, topic = String(args.topic || "").trim();
        if (!topic) return Promise.resolve({ text: say.wikipediaWhat() });
        var lang = /^[a-z]{2,3}$/.test(env.lang.id) ? env.lang.id : "en";
        var title = topic.charAt(0).toUpperCase() + topic.slice(1);
        var url = "https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")) + "?redirect=true";
        // Wikimedia asks every client to say who it is (its User-Agent policy;
        // a page cannot set User-Agent, so Api-User-Agent, which it reads too).
        return env.request({ method: "GET", url: url, headers: { Accept: "application/json", "Api-User-Agent": WIKI_AGENT } }).then(function (res) {
            if (res.status !== 200) throw new Error("HTTP " + res.status);
            return JSON.parse(res.body);
        }).then(function (r) {
            var page = r.content_urls && r.content_urls.mobile && r.content_urls.mobile.page || "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
            var open = { appId: BROWSER, params: { target: page }, title: "Wikipedia" };
            if (r.type === "disambiguation") return { text: say.wikipediaMany(r.title || title), open: open, offerWeb: true };
            if (!r.extract) throw new Error("no extract");
            return { text: say.wikipedia(r.title || title, r.extract), open: open,
                     attachments: h.cards([{ title: r.title || title, subtitle: say.fromWikipedia(), detail: r.description || "", open: open }]),
                     data: { page: page } };
        }, function (e) {
            return { text: /HTTP 404/.test(e && e.message) ? say.noWikipedia(title) : say.wikipediaOffline(), offerWeb: true };
        }).catch(function () { return { text: say.noWikipedia(title), offerWeb: true }; });
    }

    // ---- News ----
    function feeds(env) { var l = env.storage.get(FEEDS_KEY); return Array.isArray(l) ? l : DEFAULT_FEEDS.slice(); }
    function text(s) {
        return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
            .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); }).replace(/\s+/g, " ").trim();
    }
    // An RSS or Atom feed's stories: [{title, link, time}].
    function stories(xml) {
        var out = [], re = /<(item|entry)\b[\s\S]*?<\/\1>/g, m;
        while ((m = re.exec(xml)) && out.length < 30) {
            var it = m[0];
            var t = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(it);
            var l = /<link\b[^>]*href="([^"]+)"/.exec(it) || /<link\b[^>]*>([\s\S]*?)<\/link>/.exec(it);
            var d = /<(?:pubDate|published|updated|dc:date)\b[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/.exec(it);
            var title = t ? text(t[1]) : "";
            if (title) out.push({ title: title, link: l ? text(l[1]) : "", time: d ? Date.parse(text(d[1])) || 0 : 0 });
        }
        return out;
    }
    function news(args, env) {
        var say = env.lang.say, list = feeds(env);
        if (!list.length) return Promise.resolve({ text: say.noFeeds(), open: { appId: "org.webosphoenix.settings", params: { page: "assistant", section: "news" }, title: "Settings" } });
        return Promise.all(list.map(function (f) {
            return env.request({ method: "GET", url: f.url, headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } }).then(function (r) {
                if (r.status !== 200) return [];
                return stories(r.body).slice(0, 10).map(function (s) { return Object.assign(s, { source: f.title || f.url }); });
            }, function () { return []; });
        })).then(function (got) {
            // The newest first, from each feed in turn when they have no dates.
            var all = [].concat.apply([], got);
            if (!all.length) return { text: say.noNews(), offerWeb: true };
            var picked = [], seen = {};
            all.slice().sort(function (a, b) { return b.time - a.time; }).forEach(function (s) {
                var k = s.title.toLowerCase();
                if (picked.length < HEADLINES && !seen[k]) { seen[k] = true; picked.push(s); }
            });
            return { text: say.headlines(picked),
                     attachments: h.cards(picked.map(function (s) {
                         return { title: s.title, subtitle: s.source, open: s.link ? { appId: BROWSER, params: { target: s.link }, title: s.source } : undefined };
                     })) };
        });
    }

    function service(s) {
        function ok(o) { return Object.assign({ returnValue: true }, o || {}); }
        function fail(t) { return { returnValue: false, errorCode: -1, errorText: t }; }
        return {
            newsFeeds: function () { return Promise.resolve(ok({ feeds: feeds(s.env()), defaults: DEFAULT_FEEDS })); },
            setNewsFeeds: function (p) {
                if (!s.privileged()) return Promise.resolve(fail("Not allowed"));
                var l = (Array.isArray(p.feeds) ? p.feeds : []).map(function (f) {
                    return { title: String(f && f.title || "").trim().slice(0, 80), url: String(f && f.url || "").trim() };
                }).filter(function (f) { return /^https?:\/\/\S+$/i.test(f.url); }).slice(0, MAX_FEEDS);
                s.env().storage.set(FEEDS_KEY, l);
                return Promise.resolve(ok({ feeds: l }));
            }
        };
    }

    return {
        COMMANDS: COMMANDS,
        METHODS: ["newsFeeds", "setNewsFeeds"],
        service: service,
        run: function (cmd, args, env) {
            switch (cmd.id) {
            case "define": return define(args, env);
            case "spell": return spell(args, env);
            case "coin": return coin(args, env);
            case "dice": return dice(args, env);
            case "randomNumber": return randomNumber(args, env);
            case "wikipedia": return wikipedia(args, env);
            case "news": return news(args, env);
            }
            return null;
        },
        lookup: lookup,
        stories: stories
    };
};
