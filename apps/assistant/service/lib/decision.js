// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The decision model's options (docs/AI-AND-MCP.md "A decision model"):
// the complete requests the words come close to, said by the language
// (lang.candidates, lib/lang/en-candidates.js) and parsed by the grammar,
// so each is a valid command with its arguments. assistant.js decide()
// asks the model to pick one; tools/laya-curve.cjs measures how sure it is
// against how often it is right.
//
// world(env, dbFind, cat, now) -> Promise<{names, apps, alarms, events}>
// options({lang, grammar, parseCtx, commands, text, world, last, now}) -> [{label, command, args}]

"use strict";

var NOT_OPTIONS = /^(?:multi|negated|chat|beyond|undo|checkDone|help)$/;
var MAX = 8;
var REMOVES = /^(?:alarmManage|timerCancel|eventCancel)$/;

function world(env, dbFind, cat, now) {
    var until = now + 14 * 86400000;
    return Promise.all([
        dbFind(env, "com.palm.clock.alarm:1").catch(function () { return []; }),
        dbFind(env, "com.palm.calendarevent:1").catch(function () { return []; })
    ]).then(function (got) {
        return {
            names: cat.names || [],
            apps: (cat.apps || []).map(function (a) { return a.title; }).filter(Boolean),
            alarms: got[0].filter(function (a) { return !a._del; }).map(function (a) { return { hour: Number(a.hour), minute: Number(a.minute) }; }),
            events: got[1].filter(function (v) { return !v._del && Number(v.dtstart) < until && Number(v.dtend || v.dtstart) >= now - 86400000; })
                          .map(function (v) { return { title: v.subject }; })
        };
    });
}

function options(o) {
    var l = o.lang;
    if (!l.candidates) return [];
    var seen = {}, out = [];
    l.candidates(l.clean(o.text), o.world, o.last || null, o.now).forEach(function (s) {
        var p = o.grammar.parse(s, o.parseCtx);
        if (!p || NOT_OPTIONS.test(p.command) || (o.commands && !o.commands(p.command))) return;
        // Taking away only for words that take away (a model chose deleting
        // every alarm for "I want an alarm at 5:30 tomorrow morning").
        if (REMOVES.test(p.command) && l.removing && !l.removing(l.clean(o.text))) return;
        var key = p.command + JSON.stringify(p.args);
        if (seen[key]) return;
        seen[key] = true;
        out.push({ label: s.charAt(0).toUpperCase() + s.slice(1), command: p.command, args: p.args });
    });
    return out.slice(0, MAX);
}

module.exports = { world: world, options: options, MAX: MAX };
