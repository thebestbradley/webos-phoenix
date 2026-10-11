#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// How sure the decision model is against how often it is right
// (docs/AI-AND-MCP.md "A decision model"): for the first words of each
// case of a set, the options the service would offer it
// (apps/assistant/service/lib/decision.js, on the evaluation's stand-in
// device), its pick, and whether the pick is right: an option with the
// expected command (and the arguments the case names), or "something
// else" when no option has it or the case wants words. Prints the right
// share per confidence band and, per threshold, how many it would act on
// and how many of those are right; --rows FILE writes every row (the
// training data for tools/laya-train.py).
//
//   node tools/laya-curve.cjs [--cases FILE] [--decider tools/decider-laya.cjs] [--rows FILE] [--no-model]
//   --no-model: only the options (how often the right one is among them), no model asked.

"use strict";

var fs = require("fs");
var path = require("path");
var ROOT = path.join(__dirname, "..");
var SERVICE = path.join(ROOT, "apps", "assistant", "service");
var harness = require(path.join(__dirname, "eval-assistant.cjs"));
var dev = require(path.join(SERVICE, "test", "device.cjs"));
var commands = require(path.join(SERVICE, "lib", "commands.js"));
var decision = require(path.join(SERVICE, "lib", "decision.js"));
var grammar = require(path.join(SERVICE, "lib", "grammar.js"));
var en = require(path.join(SERVICE, "lib", "lang", "en.js"));

function wanted(e) {
    var list = [];
    (e.anyOf || e.all || [e]).forEach(function (x) {
        if (x.command) [].concat(x.command).forEach(function (c) { list.push({ command: c, args: x.args }); });
    });
    return list;
}

function rowsFor(cases, decider, noModel) {
    var d = dev.device({ seed: harness.seed, apps: harness.APPS, settings: { followUps: false, localModel: "off" } });
    var env = { luna: d.luna, request: function () { return Promise.reject(new Error("offline")); }, now: function () { return dev.NOW; }, lang: en };
    return commands.contactNames(env).then(function (names) {
        var cat = { names: names, apps: harness.APPS };
        return decision.world(env, commands.dbFind, cat, dev.NOW).then(function (world) {
            var rows = [];
            return cases.reduce(function (p, c) {
                return p.then(function () {
                    var t = c.turns ? c.turns[0] : { say: c.say, expect: c.expect };
                    var e = t.expect || {};
                    var want = wanted(e);
                    var options = decision.options({ lang: en, grammar: grammar, text: t.say, world: world, last: null, now: dev.NOW,
                                                     parseCtx: { lang: "en", now: dev.NOW, apps: harness.APPS, names: names } });
                    if (!options.length) return;
                    var right = [], close = [];
                    options.forEach(function (o, i) {
                        if (want.some(function (w) { return w.command === o.command && (!w.args || harness.matches(w.args, o.args)); })) right.push(i);
                        // The command, without all it was told ("Text Sam" for "text Sam I'm late"): it asks for the rest.
                        else if (want.some(function (w) { return w.command === o.command; })) close.push(i);
                    });
                    // Nothing offered is it: the general model's ("something else").
                    if (!right.length) right.push("else");
                    var row = { id: c.id, cat: c.cat, text: t.say, options: options.map(function (o) { return o.label; }), commands: options.map(function (o) { return o.command; }), right: right, close: close };
                    rows.push(row);
                    if (noModel) return;
                    return decider.decide({ text: t.say, history: [], options: row.options }).then(function (r) {
                        row.pick = r ? r.choice : null;
                        row.p = r ? r.confidence : 0;
                        row.ok = r ? right.indexOf(r.choice) >= 0 : false;
                        row.isClose = r ? close.indexOf(r.choice) >= 0 : false;
                    });
                });
            }, Promise.resolve()).then(function () { return rows; });
        });
    });
}

function report(rows, noModel) {
    var reachable = rows.filter(function (r) { return r.right[0] !== "else"; }).length;
    console.log("asked: " + rows.length + " (the right request among the options: " + reachable + "; else \"something else\" is right)");
    if (noModel) return;
    var right = rows.filter(function (r) { return r.ok; }).length;
    console.log("its pick right: " + right + " of " + rows.length);
    var bands = [[0, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]];
    console.log("\nconfidence   picks  right");
    bands.forEach(function (b) {
        var inb = rows.filter(function (r) { return r.p >= b[0] && r.p < b[1]; });
        var ok = inb.filter(function (r) { return r.ok; }).length;
        console.log(("  " + b[0].toFixed(1) + "-" + Math.min(b[1], 1).toFixed(1)).padEnd(13) + String(inb.length).padStart(5) + "  " + (inb.length ? Math.round(100 * ok / inb.length) + "%" : "-"));
    });
    // Per threshold: the picks of a request it would act on (or read back), right,
    // close (the command, asking for the rest), or another command (wrong).
    console.log("\nthreshold  requests picked  right  close  wrong command   \"something else\" right  wrong");
    [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95].forEach(function (th) {
        var acts = rows.filter(function (r) { return typeof r.pick === "number" && r.p >= th; });
        var ok = acts.filter(function (r) { return r.ok; }).length, near = acts.filter(function (r) { return r.isClose; }).length;
        var other = rows.filter(function (r) { return r.pick === "else" && r.p >= th; });
        var otherOk = other.filter(function (r) { return r.ok; }).length;
        console.log(("  " + th.toFixed(2)).padEnd(11) + String(acts.length).padStart(15) + String(ok).padStart(7) + String(near).padStart(7) +
                    String(acts.length - ok - near).padStart(15) + String(otherOk).padStart(27) + String(other.length - otherOk).padStart(7));
    });
}

if (require.main === module) {
    var argv = process.argv.slice(2), opts = { cases: harness.CASES, decider: path.join(__dirname, "decider-laya.cjs") };
    for (var i = 0; i < argv.length; ++i) {
        if (argv[i] === "--cases") opts.cases = argv[++i];
        else if (argv[i] === "--decider") opts.decider = argv[++i];
        else if (argv[i] === "--rows") opts.rows = argv[++i];
        else if (argv[i] === "--no-model") opts.noModel = true;
    }
    var decider = opts.noModel ? null : require(path.resolve(opts.decider));
    rowsFor(harness.loadCases(opts.cases), decider, opts.noModel).then(function (rows) {
        report(rows, opts.noModel);
        if (opts.rows) fs.writeFileSync(opts.rows, JSON.stringify(rows, null, 0).replace(/\},\{/g, "},\n{") + "\n");
        if (decider && decider.stats) console.log("\nDecision model: " + JSON.stringify(decider.stats()));
    }).catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
}

module.exports = { rowsFor: rowsFor, report: report };
