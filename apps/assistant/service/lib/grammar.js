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

function parse(text, ctx) {
    ctx = ctx || {};
    var lang = language(ctx.lang);
    var t = lang.clean(text);
    if (!t) return null;
    var c = { now: ctx.now || Date.now(), original: String(text), apps: ctx.apps || [], names: ctx.names || [], appCommands: ctx.appCommands || [] };
    for (var i = 0; i < lang.rules.length; ++i) {
        var args = lang.rules[i][1](t, c);
        if (args) return { command: lang.rules[i][0], args: args };
    }
    return null;
}

module.exports = { parse: parse, compileAppCommands: compileAppCommands, language: language, LANGUAGES: Object.keys(LANGS) };
