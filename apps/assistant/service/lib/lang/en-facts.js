// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for lib/commands-facts.js: definitions, spelling, coins, dice,
// random numbers, Wikipedia and the news. h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    var WORD = "([a-z][a-z'-]*)";
    function define(t, ctx) {
        var m = new RegExp("^(?:define|definition of|give me the definition of|what(?:'s| is) the (?:definition|meaning) of|meaning of|look up the word|dictionary|what(?:'s| is) a definition of|tell me what) (?:the word |a |an )?\"?" + WORD + "\"?(?: means| in the dictionary)?$").exec(t) ||
                new RegExp("^what does (?:the word )?\"?" + WORD + "\"? mean$|^what(?:'s| is) the meaning of the word " + WORD + "$").exec(t);
        if (!m) return null;
        var w = m[1] || m[2];
        // "the meaning of life" is not a dictionary's question.
        if (/^(?:life|it|this|that|love|christmas)$/.test(w) && !/\bword\b|^define/.test(t)) return null;
        return { word: w };
    }
    function spell(t, ctx) {
        var m = /^(?:how (?:do you|do i|to|does one|would you|should i|can i) spell|spell(?: the word| out)?|how is|how's|what(?:'s| is) the spelling of(?: the word)?) "?([a-z][a-z' -]{0,40}?)"?(?: spelled| spelt)?$/.exec(t);
        if (!m) return null;
        if (/^how(?: is|'s) /.test(t) && !/ (?:spelled|spelt)$/.test(t)) return null;
        var w = m[1].trim();
        if (w.split(" ").length > 3 || /^(?:it|that|this|me)$/.test(w)) return null;
        return { word: h.cased(w, ctx) };
    }
    function coin(t) { return /^(?:flip|toss)(?: me| us)?(?: a| the)? coin(?: for me)?$|^heads or tails$|^coin (?:flip|toss)$/.test(t) ? {} : null; }
    var NUM = "(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twenty)";
    function num(s) { return /^(?:a|an)$/.test(s) ? 1 : h.number(s) || Number(s) || 0; }
    function dice(t) {
        var m = new RegExp("^(?:roll|throw|toss)(?: me)?(?: " + NUM + ")?(?: " + NUM + "[- ]sided)? (?:die|dice|dies)$").exec(t);
        if (m) return { count: m[1] ? num(m[1]) : (/dice$/.test(t) ? 2 : 1), sides: m[2] ? num(m[2]) : 6 };
        if ((m = new RegExp("^(?:roll|throw)(?: me)?(?: " + NUM + ")? d(\\d+)s?$").exec(t))) return { count: m[1] ? num(m[1]) : 1, sides: Number(m[2]) };
        if (/^(?:roll|throw) (?:the |some )?dice$/.test(t)) return { count: 2, sides: 6 };
        return null;
    }
    function randomNumber(t) {
        var m = new RegExp("^(?:pick|choose|give me|generate|think of|say|tell me)(?: me)? (?:a |any )?(?:random )?number(?: (?:between|from) (-?\\d+) (?:and|to) (-?\\d+))?$|^(?:a )?random number(?: (?:between|from) (-?\\d+) (?:and|to) (-?\\d+))?$").exec(t);
        if (!m) return null;
        if (!/random/.test(t) && !m[1]) return null;   // "give me a number" alone: not this
        var lo = m[1] || m[3], hi = m[2] || m[4];
        return lo !== undefined ? { min: Number(lo), max: Number(hi) } : {};
    }
    function wikipedia(t, ctx) {
        var m = /^(?:look up|search|find|check|search for) (.+?) (?:on|in) wikipedia$|^what does wikipedia say (?:about|on) (.+)$|^wikipedia(?: for| on| about)? (.+)$|^(?:search|look up|check|look on) wikipedia (?:for|about|on) (.+)$|^(?:read|give|show) me the wikipedia (?:article|page|entry|summary) (?:on|for|about) (.+)$|^(?:tell me|what does it say) about (.+?) (?:from|on|according to) wikipedia$/.exec(t);
        if (!m) return null;
        var topic = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
        return { topic: h.cased(topic.replace(/^(?:the article (?:on|about) )/, "").replace(/^the /, ""), ctx) };
    }
    function news(t) {
        return /^(?:what(?:'s| is) (?:the |in the )?(?:latest |top )?news(?: today| this morning| tonight)?|(?:read|tell|give) me (?:the |today's |my )?(?:latest |top )?(?:news|headlines)(?: briefing)?|(?:the |today's |my )?(?:latest |top )?(?:news|headlines)(?: briefing| today| please)?|(?:my )?news briefing|what are (?:the |today's )?(?:top )?headlines(?: today)?|any (?:news|headlines)(?: today)?|what's happening in the (?:world|news)(?: today)?|catch me up on the news)$/.test(t) ? {} : null;
    }

    var POS = { n: "noun", v: "verb", a: "adjective", r: "adverb" };
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    function q(s) { return "“" + s + "”"; }
    function sentences(s, n) {
        var parts = String(s).match(/[^.!?]+[.!?]+(?:\s|$)/g) || [String(s)];
        return parts.slice(0, n).join("").trim();
    }
    var say = {
        definition: function (word, senses, form) {
            var first = senses[0], more = senses.slice(1).filter(function (s) { return s[1] !== first[1]; });
            return cap(word) + (form ? " (" + form + ")" : "") + ", " + POS[first[0]] + ": " + first[1] + "." +
                   (more.length ? " Also" + (more[0][0] !== first[0] ? ", as " + (more[0][0] === "a" || more[0][0] === "r" ? "an " : "a ") + POS[more[0][0]] : "") + ": " + more[0][1] + "." : "");
        },
        noDefinition: function (word) { return "I don't have " + q(word) + " in the dictionary on the phone."; },
        spellWhat: function () { return "Which word? Say it like “how do you spell necessary”."; },
        spelled: function (word, unknown) {
            var letters = word.replace(/[ ]/g, "").toUpperCase().split("").join("-");
            return cap(word) + " is spelled " + letters + "." + (unknown ? " That's as I heard it; it isn't in the dictionary on the phone." : "");
        },
        coin: function (heads) { return heads ? "Heads." : "Tails."; },
        rolled: function (rolls, sides) {
            var d = sides === 6 ? "" : " (d" + sides + ")";
            if (rolls.length === 1) return "You rolled " + rolls[0] + d + ".";
            return "You rolled " + h.list(rolls.map(String)) + d + ": " + rolls.reduce(function (a, b) { return a + b; }, 0) + " in all.";
        },
        randomNumber: function (n, lo, hi) { return n + ". (A random number from " + lo + " to " + hi + ".)"; },
        wikipediaWhat: function () { return "What should I look up? Say it like “look up Ada Lovelace on Wikipedia”."; },
        wikipedia: function (title, extract) { return "From Wikipedia, " + title + ": " + sentences(extract, 3); },
        fromWikipedia: function () { return "Wikipedia · CC BY-SA 4.0"; },
        wikipediaMany: function (title) { return q(title) + " could mean several things on Wikipedia. I've opened the list."; },
        noWikipedia: function (title) { return "Wikipedia has no article called " + q(title) + "."; },
        wikipediaOffline: function () { return "I couldn't reach Wikipedia right now."; },
        noFeeds: function () { return "You have no news feeds. Add one in Settings > Assistant > News."; },
        noNews: function () { return "I couldn't get the news from your feeds right now."; },
        headlines: function (list) {
            var by = list[0] ? list[0].source : "";
            var same = list.every(function (s) { return s.source === by; });
            return "Here are the latest headlines" + (same && by ? " from " + by : "") + ": " + list.map(function (s) { return s.title.replace(/[.!?]+$/, ""); }).join(". ") + ".";
        }
    };

    return {
        // Before the grammar's own; all held to their own words.
        rules: [["define", define], ["spell", spell], ["coin", coin], ["dice", dice], ["randomNumber", randomNumber], ["wikipedia", wikipedia], ["news", news]],
        say: say,
        MENTIONS: {},
        describe: function (command, args) {
            if (command === "define") return "define " + (args.word || "it");
            if (command === "spell") return "spell " + (args.word || "it");
            if (command === "wikipedia") return "look up " + (args.topic || "it") + " on Wikipedia";
            if (command === "news") return "read the headlines";
            return "";
        },
        help: { title: "Quick Facts", examples: ["Define serendipity", "How do you spell rhythm?", "Flip a coin", "Roll two dice", "Look up Ada Lovelace on Wikipedia", "What's the news?"] }
    };
};
