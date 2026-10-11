// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Layer 2 of the Assistant (docs/M6-PLAN.md F3): a fixed grammar per
// language, matched against what the user said or typed. No language model:
// it answers at once and offline, or says it does not know (null), and the
// router goes on to the on-device model or offers a cloud model.
//
//   parse(text, ctx) -> {command, args} | null
//     ctx: {lang ("en"), now (ms), apps: [{id, title, keywords}],
//           names: [contact names], appCommands: compiled (below)}
//   compileAppCommands(apps, lang) -> [{key, appId, title, url, launchParam,
//           risk, quickAction, phrases}]
//
// Apps add commands in appinfo.json, in the shape of Just Type's Quick
// Actions (universalSearch.action: displayName, url, launchParam) with the
// phrases that start them, per language; {text} is what is passed on:
//
//   "assistant": {"commands": [{"displayName": "New Task",
//       "url": "org.webosphoenix.tasks", "launchParam": "text",
//       "phrases": {"en": ["add {text} to my tasks", "new task {text}"]},
//       "risk": "change"}]}
//
// An app's Just Type Quick Action counts too, as "<displayName> {text}"
// ("search maps coffee"), after the built-in commands (which do the thing,
// where a Quick Action only opens the app on it: "new event ..." adds the
// event rather than opening Calendar's editor). Phrases an app declares
// come before the built-in commands. risk "send" or "delete" makes
// the assistant read the command back and ask first.

"use strict";

var LANGS = { en: require("./lang/en") };

function language(id) {
    return LANGS[String(id || "en").slice(0, 2)] || LANGS.en;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// A phrase as a pattern for the cleaned text: {text} is what is passed on.
function phrasePattern(phrase, lang) {
    var p = lang.clean(phrase);
    var parts = p.split(/\{text\}/);
    return parts.map(escapeRe).join("(.+)");
}

function compileAppCommands(apps, langId) {
    var lang = language(langId), out = [];
    (apps || []).forEach(function (a) {
        var declared = a.assistant && Array.isArray(a.assistant.commands) ? a.assistant.commands : [];
        declared.forEach(function (c, i) {
            if (!c || typeof c !== "object") return;
            var phrases = c.phrases && (c.phrases[lang.id] || (Array.isArray(c.phrases) ? c.phrases : null));
            if (!Array.isArray(phrases) || !phrases.length) return;
            out.push({
                key: a.id + "#" + (c.id || i),
                appId: a.id,
                title: String(c.displayName || a.title || a.id),
                description: String(c.description || c.displayName || ""),
                url: String(c.url || a.id),
                launchParam: c.launchParam ? String(c.launchParam) : "",
                risk: c.risk === "send" || c.risk === "delete" ? c.risk : "change",
                phrases: phrases.filter(function (p) { return typeof p === "string" && p.trim(); })
                    .map(function (p) { return phrasePattern(p, lang); })
            });
        });
        var qa = a.universalSearch && a.universalSearch.action;
        if (qa && qa.displayName && !declared.length) {
            out.push({
                key: a.id + "#quickAction",
                appId: a.id,
                title: String(qa.displayName),
                description: String(qa.displayName) + " (" + (a.title || a.id) + ")",
                url: String(qa.url || a.id),
                launchParam: qa.launchParam ? String(qa.launchParam) : "",
                risk: "change",
                quickAction: true,
                phrases: [phrasePattern(qa.displayName + " {text}", lang)]
            });
        }
    });
    return out;
}

// -> {command, args} | null. Besides one command, it may be:
//   {command: "multi", args: {parts: [{command, args}, ...]}}: several
//     requests in one ("turn off wifi and set an alarm for 6")
//   {command: "negated", args: {command, args, words, that}}: what not to
//     do ("don't turn on wifi"): nothing is done, and the router says so
// and {normalized: words} when it was read after typos were mended
// ("turn of wifi", "set an alrm for 7am"): a second try only.
function parse(text, ctx) {
    ctx = ctx || {};
    var lang = language(ctx.lang);
    var t = lang.clean(text);
    if (!t) return null;
    var c = { now: ctx.now || Date.now(), original: String(ctx.original || text), apps: ctx.apps || [], names: ctx.names || [], appCommands: ctx.appCommands || [] };
    var found = attempt(lang, t, c, 0);
    if (found || !lang.normalize) return found;
    var fixed = lang.normalize(t, c.names);
    if (fixed && (found = attempt(lang, fixed, c, 0))) found.normalized = fixed;
    return found;
}
function one(lang, t, c) {
    var found = byRules(lang, t, c);
    if (found || !lang.casual) return found;
    // Casual words ("kill the wifi for now"), said again as the rules know them.
    var again = lang.casual(t);
    for (var k = 0; k < again.length; ++k)
        if ((found = byRules(lang, again[k], c))) return found;
    return null;
}
function attempt(lang, t, c, depth) {
    var found = one(lang, t, c);
    if (lang.multiples && !found) {
        var said = lang.multiples(t), parts = said ? said.map(function (x) { return one(lang, x, c); }) : null;
        if (parts && parts.every(Boolean)) return { command: "multi", args: { parts: parts } };
    }
    var multi = depth < 2 && lang.splits ? split(lang, t, c, depth) : null;
    if (multi) return multi;
    if (found) return found;
    if (lang.negation) {
        var n = lang.negation(t);
        if (n) {
            var inner = one(lang, n.rest, c);
            if (inner && inner.command === "multi") inner = null;
            return { command: "negated", args: { command: inner ? inner.command : "", args: inner ? inner.args : {}, words: n.rest, that: !!n.that, need: n.need || "" } };
        }
    }
    return null;
}
// A known contact or a number: a call or text to anyone else is no
// request of its own ("remind me to buy eggs and call the plumber").
function addressed(r, c) {
    if (!r || (r.command !== "call" && r.command !== "text")) return true;
    if (r.args.number || /^[+\d][\d\s().-]{2,}$/.test(String(r.args.who || ""))) return true;
    var who = String(r.args.who || "").toLowerCase();
    return (c.names || []).some(function (n) { return String(n).toLowerCase() === who || String(n).toLowerCase().split(" ")[0] === who; });
}
// Each place the words may divide where both sides are requests of their
// own, the second starting as a request does (or saying the first one's
// verb again: "turn off wifi and bluetooth").
function split(lang, t, c, depth) {
    var re = new RegExp(lang.splits.source, "g"), m;
    while ((m = re.exec(t))) {
        var left = t.slice(0, m.index).trim(), right = t.slice(m.index + m[0].length).trim();
        if (!left || !right) continue;
        var carried = lang.carry ? lang.carry(left, right) : null;
        if (!lang.startsCommand(right) && !carried) continue;
        var L = one(lang, left, c);
        if (!L || L.command === "beyond" || !addressed(L, c)) continue;
        // "call sam and tell him I'm on my way": the call.
        if (L.command === "call" && /^tell (?:him|her|them)\b/.test(right)) return L;
        var R = (lang.startsCommand(right) ? attempt(lang, right, c, depth + 1) : null) || (carried ? attempt(lang, carried, c, depth + 1) : null);
        if (!R || R.command === "beyond" || R.command === "negated") continue;
        // "call sam and tell him I'm on my way": the call.
        if (L.command === "call" && R.command === "text" && /^(?:him|her|them)$/.test(String(R.args.who || ""))) return L;
        if (!addressed(R, c)) continue;
        var parts = [L].concat(R.command === "multi" ? R.args.parts : [R]);
        // The same request said twice ("no calls for a while, go silent"): once.
        parts = parts.filter(function (p, i) { return !parts.slice(0, i).some(function (q) { return JSON.stringify(q) === JSON.stringify(p); }); });
        return parts.length > 1 ? { command: "multi", args: { parts: parts } } : parts[0];
    }
    return null;
}
function byRules(lang, t, c) {
    for (var i = 0; i < lang.rules.length; ++i) {
        var args = lang.rules[i][1](t, c);
        if (args) return { command: lang.rules[i][0], args: args };
    }
    return null;
}

module.exports = { parse: parse, compileAppCommands: compileAppCommands, language: language, LANGUAGES: Object.keys(LANGS) };
