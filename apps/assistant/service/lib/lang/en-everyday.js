// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for the everyday features (lib/commands-everyday.js), each
// area's words in a file of its own:
//
//   en-notify.js     what did I miss, announcing messages, driving mode
//   en-routines.js   routines, their starters and the steps Settings offers
//
// Each area: (h) -> {rules: [[command, (t, ctx) -> args | null]] (tried
// before the grammar's own, so each is held to its own words), late?:
// rules tried after them (before "open an app"), say: its words,
// MENTIONS: the words a model's choice of a command that changes
// something needs (lang grounded()), describe(command, args): the
// read-back's words, help: {title, examples} (help), lang?: more of the
// language's own (routineStarters(), ...)}.
// h: lib/lang/en.js's helpers.

"use strict";

var AREAS = [require("./en-notify"), require("./en-routines")];

module.exports = function (h) {
    var areas = AREAS.map(function (make) { return make(h); });
    var out = { rules: [], late: [], say: {}, MENTIONS: {}, help: [], lang: {} };
    areas.forEach(function (a) {
        out.rules = out.rules.concat(a.rules || []);
        out.late = out.late.concat(a.late || []);
        Object.assign(out.say, a.say || {});
        Object.assign(out.MENTIONS, a.MENTIONS || {});
        Object.assign(out.lang, a.lang || {});
        if (a.help) out.help.push(a.help);
    });
    out.describe = function (command, args, title) {
        for (var i = 0; i < areas.length; ++i) {
            var d = areas[i].describe ? areas[i].describe(command, args || {}, title) : "";
            if (d) return d;
        }
        return "";
    };
    return out;
};
