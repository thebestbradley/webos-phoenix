// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Posts and names as plain text: a status's content is HTML
// (https://docs.joinmastodon.org/entities/Status/#content: <p>, <br>,
// links, mention and hashtag spans), and display names may carry custom
// emoji shortcodes (":blobcat:", https://docs.joinmastodon.org/entities/CustomEmoji/),
// which a contact's name and a notification have no picture for.

"use strict";

var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
        if (e.charAt(0) === "#") {
            var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return isNaN(n) ? m : String.fromCodePoint(n);
        }
        return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
    });
}

// Paragraphs and line breaks kept; the rest of the markup dropped.
function plainText(html) {
    return decode(String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
        .replace(/<span class="invisible">[^<]*<\/span>/gi, "")
        .replace(/<[^>]*>/g, ""))
        .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// A display name without custom emoji shortcodes; the account's username
// when nothing is left.
function displayName(account) {
    var n = String((account && account.display_name) || "").replace(/:[A-Za-z0-9_]+:/g, "").replace(/\s+/g, " ").trim();
    return n || String((account && account.username) || "");
}

// The contacts framework's name: the last word the family name, the rest given.
function nameOf(account) {
    var n = displayName(account);
    var words = n.split(" ").filter(Boolean);
    if (words.length < 2) return { givenName: n, familyName: "" };
    return { givenName: words.slice(0, -1).join(" "), familyName: words[words.length - 1] };
}

// "anna@example.social" for any account (a local account's acct has no domain).
function fullAcct(account, ownDomain) {
    var acct = String((account && account.acct) || "");
    return acct.indexOf("@") >= 0 ? acct : acct + "@" + ownDomain;
}

function shorten(text, n) {
    text = String(text || "");
    return text.length > n ? text.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : text;
}

module.exports = { plainText: plainText, displayName: displayName, nameOf: nameOf, fullAcct: fullAcct, shorten: shorten, decode: decode };
