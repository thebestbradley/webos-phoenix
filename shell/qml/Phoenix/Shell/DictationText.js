// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dictation's text (GAPS V2): punctuation said aloud becomes the mark, as
// iOS's and Android's dictation do: "see you soon comma Ada period" types
// "see you soon, Ada." In the keyboard's languages (English, German,
// French; with no language, English). The speech recognizer (whisper.cpp)
// often puts in its own commas and full stops around the spoken word ("Hi,
// comma, Ada."): those go, the spoken mark stays. "new line" and "new
// paragraph" break the line, and the next word starts a sentence.
//
//   spokenPunctuation(text, lang)   the text with the spoken marks typed

.pragma library

// Longest first ("question mark" before "mark" words).
var WORDS = {
    en: [["new paragraph", "\n\n"], ["new line", "\n"], ["question mark", "?"],
         ["exclamation mark", "!"], ["exclamation point", "!"], ["full stop", "."],
         ["period", "."], ["semicolon", ";"], ["semi colon", ";"], ["comma", ","], ["colon", ":"]],
    de: [["neuer Absatz", "\n\n"], ["neue Zeile", "\n"], ["Fragezeichen", "?"],
         ["Ausrufezeichen", "!"], ["Doppelpunkt", ":"], ["Semikolon", ";"], ["Strichpunkt", ";"],
         ["Komma", ","], ["Punkt", "."]],
    fr: [["nouveau paragraphe", "\n\n"], ["nouvelle ligne", "\n"], ["à la ligne", "\n"],
         ["point d'interrogation", "?"], ["point d'exclamation", "!"], ["point virgule", ";"],
         ["deux points", ":"], ["virgule", ","], ["point", "."]]
};
var LETTER = "A-Za-zÀ-ɏ";

function _escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function spokenPunctuation(text, lang) {
    var list = WORDS[lang] || WORDS.en;
    var alt = list.map(function (e) {
        // A space or hyphen between the words ("semi-colon", "deux-points");
        // the apostrophe as typed or curly.
        return _escape(e[0]).replace(/ /g, "[\\s-]+").replace(/'/g, "['’]");
    }).join("|");
    // What comes before (kept unless it is the recognizer's own spacing or
    // punctuation), the word, and the recognizer's punctuation after it.
    var re = new RegExp("(^|[^" + LETTER + "'])[\\s,.;:!?]*(" + alt + ")(?![" + LETTER + "])[,.;:!?]*", "gi");
    var marks = {};
    list.forEach(function (e) { marks[e[0].toLowerCase()] = e[1]; });
    var out = String(text).replace(re, function (all, before, word) {
        var key = word.toLowerCase().replace(/[\s-]+/g, " ").replace(/’/g, "'");
        var mark = marks[key];
        if (mark === undefined)
            return all;
        return (/^[\s,.;:!?]?$/.test(before) ? "" : before) + "\u0001" + mark + "\u0002";
    });
    if (out === text)
        return text;
    // A new line: no spaces around it. A mark: none before it.
    out = out.replace(/[ \t]*\u0001(\n+)\u0002[ \t]*/g, "$1")
             .replace(/[ \t]*\u0001([^\u0002]*)\u0002/g, "$1");
    // A sentence starts after . ! ? and a new line.
    out = out.replace(/([.!?]\s+|\n)([a-zà-ÿ])/g, function (all, sep, ch) { return sep + ch.toUpperCase(); });
    return out.replace(/^[ \t]+/, "");
}
