// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Search your phone in English (lib/commands-search.js): the words that ask
// for the user's things by what they are about, and what the assistant
// says back. Made by lib/lang/en.js with its helpers:
// require("./en-search")(h) -> {rules: [[command, fn]], say: {...},
// personal(text)}.
//
// What the older rules already take stays theirs ("find my notes about
// wifi" findNotes, "find the email about the boiler" searchEmail, "show
// photos of the beach" photos): they look for the words, and the index
// takes over when none has them. These are what nothing took:
//
//   "what did Sam say about the party", "did Sam text me anything about
//   dinner", "find the message from Priya about lunch"   messages, theirs
//   "where's that note about the wifi password"          a memo
//   "where's that email about the boiler"                an email
//   "find the voice memo about the garden"               a voice memo
//   "search my phone for the insurance renewal", "find anything about
//   the boiler", "do I have anything about the cabin"   everywhere

"use strict";

module.exports = function (h) {
    var quote = h.quote;
    function q(s) { return String(s || "").replace(/^(?:the|my|our|that|a|an|some|any) /, "").replace(/[?.!]+$/, "").trim(); }
    function about(words, ctx) { return h.cased(q(words), ctx); }

    var KINDS = "(?:note|memo|e-?mail|mail|message|text|chat|sms|voice ?memo|voice note|recording|document|file|photo|picture|event|appointment|task|reminder|contact)";
    var SOURCE_OF = function (kind) {
        return /note|memo/.test(kind) && !/voice/.test(kind) ? "memos" : /mail/.test(kind) ? "email" : /message|text|chat|sms/.test(kind) ? "messages"
            : /voice|recording/.test(kind) ? "voicememos" : /document|file/.test(kind) ? "files" : /photo|picture/.test(kind) ? "photos"
            : /event|appointment/.test(kind) ? "events" : /task|reminder/.test(kind) ? "tasks" : /contact/.test(kind) ? "contacts" : "";
    };

    // "what did Sam say about the party", "what has Priya said about lunch"
    function theirWords(t, ctx) {
        var m = /^what (?:did|has|had) (.+?) (?:say|said|text|texted|write|written|wrote|send|sent|tell me|told me|mention|mentioned)(?: me| to me)? (?:about|regarding|on) (.+)$/.exec(t)
            || /^(?:did|has) (.+?) (?:say|said|text|texted|write|written|mention|mentioned|send|sent)(?: me)? anything (?:about|regarding|on) (.+)$/.exec(t)
            || /^(?:find|show(?: me)?|look for|search for|get|where(?:'s| is)) (?:the |that |a |my )?(?:messages?|texts?|chats?|sms) from (.+?) (?:about|regarding|mentioning|on) (.+)$/.exec(t);
        if (!m) return null;
        var who = h.cased(m[1].trim(), ctx), what = about(m[2], ctx);
        if (!what || /^(?:you|it|that|this|me)$/.test(who)) return null;
        return { query: what, source: "messages", who: who };
    }
    // "where's that note about the wifi password", "find that email about the boiler", "find the voice memo about the garden"
    function thatThing(t, ctx) {
        // "where's the/my/that ...", or another verb with "that"/"this" ("find
        // the email about ..." stays searchEmail's, "find my notes about ..."
        // findNotes': they look for the words first).
        var tail = "s? (?:i (?:wrote|made|took|got|had|sent|recorded|saved) )?(?:about|on|regarding|mentioning|with|where (?:i|we|they) (?:talk|talked|wrote|said) about) (.+)$";
        var m = new RegExp("^(?:where(?:'s| is| are) (?:that|this|the|my)|(?:find|show(?: me)?|open|get|look for|search for|pull up|bring up) (?:that|this)) (" + KINDS + ")" + tail).exec(t)
            // What no older rule takes, with any of them: messages, voice memos.
            || new RegExp("^(?:find|show(?: me)?|open|play|get|look for|search for|pull up) (?:the|my|any) (message|text|chat|sms|voice ?memo|voice note|recording)" + tail).exec(t);
        if (!m) return null;
        var what = about(m[2], ctx);
        return what ? { query: what, source: SOURCE_OF(m[1]), who: "" } : null;
    }
    // "search my phone for the boiler", "find anything about the cabin", "do I have anything on the insurance"
    function anything(t, ctx) {
        var m = /^(?:search|look through|look in|check) (?:my |the |this )?(?:phone|device|stuff|things|everything|data)(?: for| about)? (.+)$/.exec(t)
            || /^(?:find|search for|look for|show(?: me)?|get) (?:anything|everything|all|stuff|things|whatever)(?: i have| i've got| there is)? (?:about|on|regarding|related to|to do with|mentioning) (.+)$/.exec(t)
            || /^(?:find|look for|search for) (.+?) on (?:my|the|this) phone$/.exec(t)
            || /^(?:do i have|have i got|is there) anything (?:about|on|regarding) (.+)$/.exec(t)
            || /^what do i have (?:about|on) (.+)$/.exec(t);
        if (!m) return null;
        var what = about(m[1], ctx);
        return what ? { query: what, source: "", who: "" } : null;
    }

    var NOUNS = { memos: ["memo", "memos"], email: ["email", "emails"], messages: ["message", "messages"], events: ["event", "events"],
                  contacts: ["contact", "contacts"], tasks: ["task", "tasks"], files: ["file", "files"], photos: ["photo", "photos"],
                  voicememos: ["voice memo", "voice memos"] };
    function article(w) { return /^[aeiou]/i.test(w) ? "an" : "a"; }
    function noun(source, n) { var x = NOUNS[source] || ["thing", "things"]; return n === 1 ? x[0] : x[1]; }
    function named(r) {
        var what = r.source === "messages" ? (r.title === "You" ? "your message to " + (r.who || "someone") : "a message from " + r.title)
            : r.source === "email" ? "an email " + quote(r.title) + (r.who ? " from " + r.who : "")
            : r.source === "memos" ? "a memo " + quote(h.excerpt(r.title, 50))
            : r.source === "photos" ? "a photo, " + r.title
            : (article(noun(r.source, 1)) + " " + noun(r.source, 1) + " " + quote(h.excerpt(r.title, 50)));
        return what;
    }

    var say = {
        phoneWhat: function () { return "What should I look for?"; },
        phoneNothing: function (query, source, who) {
            if (who) return "I couldn't find anything " + who + " said about " + quote(query) + ".";
            return "I couldn't find " + (source ? article(noun(source, 1)) + " " + noun(source, 1) : "anything") + " about " + quote(query) + " on your phone.";
        },
        phoneFound: function (query, source, who, results, now) {
            var top = results[0], n = results.length;
            // Their words, read out: the best match.
            if (top.source === "messages" && who)
                return who + " said, " + h.dayText(top.time, now) + " at " + h.timeText(top.time) + ": " + quote(top.snippet.replace(/^[^:]{1,60}: /, "")) +
                       (n > 1 ? " " + (n === 2 ? "And one more message." : "And " + (n - 1) + " more messages.") : "");
            if (source && results.every(function (r) { return r.source === source; })) {
                var firsts = results.slice(0, 3).map(function (r) { return quote(h.excerpt(r.title || r.snippet, 50)); });
                return (n === 1 ? "Here's the " + noun(source, 1) : "Here are " + n + " " + noun(source, n)) + " about " + quote(query) + ": " +
                       h.list(firsts) + (n > 3 ? ", and more" : "") + ".";
            }
            var items = results.slice(0, 3).map(named);
            return "About " + quote(query) + ", I found " + h.list(items) + (n > 3 ? ", and " + (n - 3) + " more" : "") + ".";
        },
        phoneByMeaning: function (query, source, n) {
            return "No " + noun(source, 2) + " have those words, but " + (n === 1 ? "this one is" : "these are") + " about " + quote(query) + ".";
        },
        phoneIndexOff: function () { return "To find things by what they mean, not only their words, turn on Search your phone in Settings > Assistant."; },
        phoneNeedsModel: function () { return "Search your phone needs its model, EmbeddingGemma 2 (310 MB): download it in Settings > Assistant."; },
        phoneNoIndex: function () { return "Search your phone isn't on this device."; },
        phoneSettings: function () { return "Search Settings"; }
    };

    // Whether a question to a model is about the user's own things (then
    // the index's passages go with it): it says my, me, I, our, or names
    // one of the user's kinds of things.
    function personal(text) {
        var t = String(text || "").toLowerCase();
        return /\b(?:my|mine|me|i|i'm|i've|our|we)\b/.test(t) && !/^(?:how do i|how can i|how to|what is a|what are|who (?:is|was) [a-z]+ [a-z]+$)/.test(t)
            || new RegExp("\\b" + KINDS + "s?\\b").test(t);
    }

    return {
        rules: [["searchPhone", theirWords], ["searchPhone", thatThing], ["searchPhone", anything]],
        say: say,
        personal: personal,
        mentions: /\b(?:find|search|look|where|said|say|about|anything|phone)\b/
    };
};
