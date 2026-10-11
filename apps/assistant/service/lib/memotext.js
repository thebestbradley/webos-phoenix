// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A memo's text as the original Memos (com.palm.app.notes) keeps it: the
// HTML its card and editor show, so "&", "<" and ">" are stored as
// "&amp;", "&lt;" and "&gt;" (com.palm.note:1 text):
//
//   - typed in Memos: the editor's HTML (app/views/EditView.js:178
//     getHtml), its <div>s and <br>s new lines, "&nbsp;" a space and
//     links dropped (app/models/Memo.js:25-31 sanitizeInputText);
//   - made from Just Type: escaped (app/views/GridView.js:262
//     enyo.string.escapeHtml);
//   - its title: the stored text's first 50 characters (Memo.js:76);
//   - shown as HTML (app/views/MemoView.js:52, Memo.js:65-71 displayText),
//     except text with a raw "<" or ">", written unescaped by something
//     else, which Memos escapes when it reads it (app/lib/DbApi.js:28-40),
//     so it shows as it was written (and is saved escaped when Memos next
//     saves it).
//
// The Assistant writes what it is told as Memos would (escape) and reads,
// says, matches and shows what Memos shows (plain). Memos written raw by
// older Phoenix builds read the same: text without entities is unchanged
// by unescape, and one with a raw "<" or ">" is left as it is (DbApi's
// rule). The one difference: a raw memo whose words hold a literal
// "&amp;" (and no "<" or ">") reads as "&", as Memos shows it too.

"use strict";

// enyo.string.escapeHtml (third_party/enyo-1.0/framework/source/dom/util.js:289-291).
function escape(text) {
    return text !== null && text !== undefined ? String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
}

// The reverse, with what else Memos' HTML may hold: "&nbsp;" a space (as
// sanitizeInputText makes it, Memo.js:30), quotes; "&amp;" last, so an
// "&lt;" a person typed ("&amp;lt;") stays "&lt;".
function unescape(text) {
    return text !== null && text !== undefined ? String(text).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/gi, " ")
        .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&") : "";
}

// Text Memos reads as written unescaped (DbApi.js:33).
function isRaw(text) { return /<|>/.test(String(text || "")); }

// The words a stored text shows in Memos.
function plain(text) {
    if (text === null || text === undefined) return "";
    return isRaw(text) ? String(text) : unescape(text);
}

// A stored text to write again with more (a line added, a line taken
// out): as it is stored, or, written unescaped, escaped as Memos reads it
// (DbApi.js:33-37) and saves it again.
function kept(text) {
    if (text === null || text === undefined) return "";
    return isRaw(text) ? escape(text) : String(text);
}

// The fields Memos writes for a stored text (Memo.js:75-76).
function fields(stored) { return { text: stored, title: stored.substring(0, 50) }; }

module.exports = { escape: escape, unescape: unescape, isRaw: isRaw, plain: plain, kept: kept, fields: fields };
