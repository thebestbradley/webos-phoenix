// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text into the passages the index embeds, each as EmbeddingGemma 2's
// model card asks a document to be written ("Task Instruction Prefixes":
// "title: {title} | text: {content}", "title: none" without one; a query
// is "task: search result | query: {query}").
//
// A passage is at most MAX_WORDS words and MAX_CHARS characters (some 220
// tokens with the title: one batch of the simulator's llama-server, which
// reads 512 tokens at a time, and short enough that one topic of a long
// email or document is not lost among the others; the characters too,
// as text without spaces, a key or a table, is many tokens a "word": a
// 785-token passage of the simulator's files stopped a pass), a word at
// most MAX_WORD characters, the next passage starting OVERLAP words back,
// and a record gives at most MAX_PASSAGES of them (the rest of a long
// document is left out: its start and its name find it).

"use strict";

var MAX_WORDS = 160, MAX_CHARS = 700, MAX_WORD = 40, OVERLAP = 30, MAX_PASSAGES = 8;

function clean(s) {
    return String(s === undefined || s === null ? "" : s).replace(/\u0000/g, "").replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// HTML (an email's body) as the text it shows.
function htmlText(html) {
    return clean(String(html || "")
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
        .replace(/&amp;/g, "&"));
}

// Passages of text: [{text, start}] (start: the first word's place).
function passages(text, opts) {
    opts = opts || {};
    var max = opts.maxWords || MAX_WORDS, overlap = opts.overlap === undefined ? OVERLAP : opts.overlap, most = opts.maxPassages || MAX_PASSAGES;
    var chars = opts.maxChars || MAX_CHARS;
    var words = clean(text).split(/\s+/).filter(Boolean).map(function (w) { return w.length > MAX_WORD ? w.slice(0, MAX_WORD) : w; });
    if (!words.length) return [];
    var out = [];
    for (var at = 0; at < words.length && out.length < most;) {
        var end = at, len = 0;
        while (end < words.length && end - at < max && (end === at || len + 1 + words[end].length <= chars)) { len += (end > at ? 1 : 0) + words[end].length; end++; }
        out.push({ text: words.slice(at, end).join(" "), start: at });
        if (end >= words.length) break;
        at = Math.max(at + 1, end - Math.min(overlap, Math.floor((end - at) / 4)));
    }
    return out;
}

// A passage as the model reads a document, and a query as it reads one.
function documentInput(title, text) {
    var t = clean(title).replace(/\s+/g, " ").replace(/\|/g, "/");
    return "title: " + (t || "none") + " | text: " + clean(text);
}
function queryInput(query) { return "task: search result | query: " + clean(query).replace(/\s+/g, " "); }

// FNV-1a of a string, as 8 hex digits: whether a passage changed.
function hash(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; ++i) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
}

module.exports = { passages: passages, documentInput: documentInput, queryInput: queryInput, htmlText: htmlText, clean: clean, hash: hash,
                   MAX_WORDS: MAX_WORDS, MAX_CHARS: MAX_CHARS, OVERLAP: OVERLAP, MAX_PASSAGES: MAX_PASSAGES };
