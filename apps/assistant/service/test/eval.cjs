// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Scoring the evaluation set (test/eval-phrasings.cjs): whether an answer
// reached the command it should, with the arguments it must have.

"use strict";

var SET = require("./eval-phrasings.cjs");

// Wednesday 7 October 2026, 10:00 local time, and a few apps and contacts.
var NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
var APPS = [{ id: "com.palm.app.calendar", title: "Calendar" }, { id: "com.palm.app.camera", title: "Camera" },
            { id: "org.webosphoenix.settings", title: "Settings" }, { id: "com.palm.app.notes", title: "Memos" },
            { id: "org.webosphoenix.maps", title: "Maps" }];
var NAMES = ["Sam", "Sam Delgado", "Priya", "Priya Nair", "Mom", "Alex", "Alex Rivera"];

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// Did {command, args} answer the entry?
function hits(entry, got) {
    if (!got || got.command !== entry[1]) return false;
    var want = entry[2] || {};
    return Object.keys(want).every(function (k) { return got.args && same(got.args[k], want[k]); });
}
// The grammar alone: {total, hit, misses: [[words, got, want]]}
function grammarOnly(grammar, set) {
    var ctx = { lang: "en", now: NOW, apps: APPS, names: NAMES, appCommands: grammar.compileAppCommands(APPS, "en") };
    var misses = [], hit = 0;
    (set || SET).forEach(function (e) {
        var r = grammar.parse(e[0], ctx);
        if (hits(e, r)) hit++;
        else misses.push([e[0], r ? r.command : null, e[1]]);
    });
    return { total: (set || SET).length, hit: hit, misses: misses };
}

module.exports = { SET: SET, HELD_OUT: SET.HELD_OUT, NOW: NOW, APPS: APPS, NAMES: NAMES, hits: hits, grammarOnly: grammarOnly };
