#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's evaluation (docs/AI-AND-MCP.md "Evaluation"): every
// case in apps/assistant/eval/cases.json asked of the real service
// (apps/assistant/service/assistant.js) on a stand-in device that keeps
// what is saved (apps/assistant/service/test/device.cjs), turn by turn,
// and scored by what the service did: the command it chose with its
// arguments (each answer's trace), a read-back, a question back, an answer
// in words, or "nothing here can".
//
//   node tools/eval-assistant.cjs                      the grammar alone
//   node tools/eval-assistant.cjs --model URL          + the on-device model (llama-server's /v1,
//                                                        started as the product starts it:
//                                                        -c 4096 -np 1 -fa on -b 512 --jinja)
//   node tools/eval-assistant.cjs --decider FILE.cjs   + a decision model between the grammar and
//                                                        the general model (docs/AI-AND-MCP.md
//                                                        "A slot for a decision model")
//   --cat alarms,owner   only these categories     --id ID    only this case
//   --json out.json      every turn, as answered   --md       the table as Markdown
//   --verbose            each failure, with what was said back
//   --service DIR        another copy of apps/assistant/service (a baseline)
//
// Scoring. A case passes when every turn does. The worst failure is an
// action nobody asked for ("unsafe": a command that changes, sends,
// deletes or calls, carried out and not expected); a read-back of the
// wrong thing ("wrong read-back") is next, as the user can still say no.
// Expected outcomes (a turn's "expect"):
//   {command: id | [ids], args: {...subset}, status: "done" | "pending" |
//    "ask" | "failed" | "any"}    the command, with these arguments (a time
//                                  as "YYYY-MM-DDTHH:MM", local); without
//                                  status: done or a read-back
//   {all: [expect, ...]}          several commands (multi-intent)
//   {answer: "chat"}              words, no action ("hello")
//   {answer: "knowledge"}         a question about the world: the model's
//                                  words, or, without a model, the web offered
//   {answer: "clarify"}           a question back, nothing done
//   {answer: "fallback"}          "nothing here can", gracefully, nothing done
//   forbid: [ids]                 these must not run (a negation)
//   text: "regexp"                the last reply must match (case-insensitive)
//   notText: "regexp"             ... and must not match
//   effects: [{kind, where: {...}, count}]   what the device keeps after the turn
//   and, in expect, "anyOf": [expect, ...] when more than one outcome is right.

"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var SERVICE = path.join(ROOT, "apps", "assistant", "service");
var CASES = path.join(ROOT, "apps", "assistant", "eval", "cases.json");
// --service DIR: another copy of the service (a baseline: the before of a before/after).
var serviceArg = process.argv.indexOf("--service");
if (serviceArg > 0) SERVICE = path.resolve(process.argv[serviceArg + 1]);
var dev = require(path.join(SERVICE, "test", "device.cjs"));
var commands = require(path.join(SERVICE, "lib", "commands.js"));

var RISK = {};
commands.BUILT_IN.forEach(function (c) { RISK[c.id] = c.risk; });
function acts(id) { var r = RISK[id]; return r === "change" || r === "send" || r === "delete" || r === "call"; }

// More of the user's world than the unit tests' device: family, a
// nickname, two people with one first name, an email to read.
function seed(put) {
    var NOW = dev.NOW;
    put({ _id: "p-mom", _kind: "com.palm.person:1", name: { givenName: "Mom" }, phoneNumbers: [{ value: "(303) 555-0101", type: "type_mobile" }], emails: [{ value: "mom@example.com", type: "type_home" }] });
    put({ _id: "p-alex", _kind: "com.palm.person:1", name: { givenName: "Alex", familyName: "Rivera" }, phoneNumbers: [{ value: "(303) 555-0177", type: "type_mobile" }],
          emails: [{ value: "alex@example.com", type: "type_work" }] });
    put({ _id: "p-daniel", _kind: "com.palm.person:1", name: { givenName: "Daniel", familyName: "Okafor" }, nickname: "Dan", phoneNumbers: [{ value: "(303) 555-0190", type: "type_mobile" }], emails: [] });
    put({ _id: "p-chris1", _kind: "com.palm.person:1", name: { givenName: "Chris", familyName: "Park" }, phoneNumbers: [{ value: "(303) 555-0111", type: "type_mobile" }], emails: [{ value: "cpark@example.com", type: "type_home" }] });
    put({ _id: "p-chris2", _kind: "com.palm.person:1", name: { givenName: "Chris", familyName: "Moore" }, phoneNumbers: [{ value: "(303) 555-0122", type: "type_mobile" }], emails: [] });
    put({ _id: "mail-3", _kind: "com.palm.email:1", subject: "Weekend plans", from: { name: "Mom", addr: "mom@example.com" }, summary: "Dinner Sunday?", timestamp: NOW - 1800e3,
          flags: { read: false, visible: true }, parts: [{ type: "body", mimeType: "text/plain", content: "Dinner Sunday at 6?" }] });
}

var APPS = [{ id: "com.palm.app.camera", title: "Camera" }, { id: "com.palm.app.notes", title: "Memos" }, { id: "org.webosphoenix.maps", title: "Maps" },
            { id: "org.webosphoenix.photos", title: "Photos" }, { id: "com.palm.app.clock", title: "Clock" }, { id: "com.palm.app.email", title: "Email" },
            { id: "org.webosphoenix.messaging", title: "Messaging" }, { id: "com.palm.app.contacts", title: "Contacts" },
            { id: "org.webosphoenix.music", title: "Music" }, { id: "com.palm.app.browser", title: "Web" }, { id: "org.webosphoenix.weather", title: "Weather" },
            { id: "org.webosphoenix.tasks", title: "Tasks" }, { id: "com.palm.app.calculator", title: "Calculator" },
            // The Assistant itself, with its Just Type Quick Action: never a command for itself (the owner's "Talk to me.").
            { id: "org.webosphoenix.assistant", title: "Assistant", universalSearch: { action: { displayName: "Ask Assistant", url: "org.webosphoenix.assistant", launchParam: "text" } } }];

// ---- Matching ------------------------------------------------------------------------------------
var LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
function timeOf(s) {
    var m = LOCAL_TIME.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
}
function norm(v) { return typeof v === "string" ? v.toLowerCase().replace(/[“”"'.,!?]/g, "").replace(/\s+/g, " ").trim() : v; }
function matches(want, got) {
    if (want === null || want === undefined) return got === null || got === undefined || got === "";
    if (Array.isArray(want)) {
        if (!Array.isArray(got) || got.length !== want.length) return false;
        return want.every(function (w, i) { return matches(w, got[i]); });
    }
    if (typeof want === "object") {
        if (want.$re) return new RegExp(want.$re, "i").test(String(got === undefined ? "" : got));
        if (want.$not) return !new RegExp(want.$not, "i").test(String(got === undefined ? "" : got));
        if (want.$any) return want.$any.some(function (w) { return matches(w, got); });
        if (!got || typeof got !== "object") return false;
        return Object.keys(want).every(function (k) { return matches(want[k], got[k]); });
    }
    if (typeof want === "string" && LOCAL_TIME.test(want)) {
        var t = timeOf(want);
        if (typeof got === "number") return Math.abs(got - t) < 60000;
        if (typeof got === "string" && !isNaN(Date.parse(got))) return Math.abs(Date.parse(got) - t) < 60000;
        return false;
    }
    if (typeof want === "number" && typeof got === "string") return Number(got) === want;
    return norm(want) === norm(got);
}

// What one turn did: its outcomes (the commands with their status) and how it answered.
function outcomes(msgs) {
    var out = [];
    msgs.forEach(function (m) {
        if (m.role !== "assistant" || !m.command || m.followUp) return;
        var status = m.status || (m.data && m.data.awaiting ? "ask" : "");
        var args = m.confirm ? m.confirm.args : m.trace && m.trace.args;
        out.push({ command: m.command, status: status, args: args || {}, path: m.trace ? m.trace.path : m.via });
    });
    return out;
}
function statusOk(want, got) {
    if (!want) return got === "done" || got === "pending";
    if (want === "any") return true;
    return [].concat(want).indexOf(got) >= 0;
}
function commandOk(want, got) { return [].concat(want).indexOf(got) >= 0; }
function oneMatches(e, outs) {
    return outs.some(function (o) { return commandOk(e.command, o.command) && statusOk(e.status, o.status) && (!e.args || matches(e.args, o.args)); });
}
function lastReply(msgs) {
    var a = msgs.filter(function (m) { return m.role === "assistant"; });
    return a[a.length - 1] || null;
}
function asksBack(msgs) {
    var a = msgs.filter(function (m) { return m.role === "assistant" && !m.followUp; });
    var last = a[a.length - 1];
    if (!last || last.kind === "fallback" || last.confirm) return false;
    return /\?\s*$|\?["”]?\s*$/.test(last.text) || !!(last.data && last.data.awaiting) || !!(last.choices && last.choices.length && /\bwhich\b/i.test(last.text));
}
function answerOk(kind, msgs, outs, withModel) {
    var acted = outs.filter(function (o) { return (o.status === "done" || o.status === "pending") && acts(o.command); });
    var last = lastReply(msgs);
    if (!last) return false;
    var fallback = last.kind === "fallback";
    switch (kind) {
    case "chat":
        return !acted.length && !fallback && !!String(last.text || "").trim() && !/can'?t do that/i.test(last.text);
    case "knowledge":
        if (acted.length) return false;
        if (outs.some(function (o) { return o.command === "search"; })) return true;
        if (fallback) return !withModel && (last.choices || []).some(function (c) { return c.id === "web"; });
        return !!withModel && !last.command && !!String(last.text || "").trim();
    case "clarify":
        return !acted.length && asksBack(msgs);
    case "fallback":
        return !acted.length && (fallback || (!last.command && !!String(last.text || "").trim()) || asksBack(msgs) || last.status === "failed");
    }
    return false;
}
function expectOk(e, msgs, outs, withModel) {
    if (e.anyOf) return e.anyOf.some(function (x) { return expectOk(x, msgs, outs, withModel); });
    if (e.all) return e.all.every(function (x) { return expectOk(x, msgs, outs, withModel); });
    if (e.answer) return [].concat(e.answer).some(function (k) { return answerOk(k, msgs, outs, withModel); });
    if (e.command) return oneMatches(e, outs);
    return true;
}
// Every command an expectation allows (an action among them is not unsafe).
function allowedCommands(e, into) {
    into = into || [];
    if (!e) return into;
    if (e.command) into.push.apply(into, [].concat(e.command));
    (e.all || []).concat(e.anyOf || []).forEach(function (x) { allowedCommands(x, into); });
    return into;
}
function effectsOk(effects, d) {
    return (effects || []).every(function (f) {
        var found = d.of(f.kind).filter(function (o) { return !f.where || matches(f.where, o); });
        return f.count === undefined ? found.length > 0 : found.length === f.count;
    });
}

// ---- Running ---------------------------------------------------------------------------------------
function llmFor(url) {
    if (!url) return {};
    var http = require(path.join(SERVICE, "lib", "node-http.js")).createRequest({ timeoutMs: 600000 });
    return {
        llm: { status: function () { return Promise.resolve({ available: true, installed: [{ id: "qwen3-0.6b-q8_0" }] }); },
               ensure: function () { return Promise.resolve({ baseUrl: url.replace(/\/+$/, "") }); } },
        llmRequest: function (r) {
            // The model's address as given (the device uses 127.0.0.1: the router sends it there).
            return http(r);
        }
    };
}

function runCase(c, opts) {
    var m = llmFor(opts.model);
    var settings = Object.assign({ followUps: false }, opts.model ? {} : { localModel: "off" }, opts.decider ? { decider: "on" } : {}, c.settings || {});
    var deps = {};
    if (opts.decider) deps.decider = opts.decider;
    var d = dev.device({ seed: seed, apps: APPS, llm: m.llm, llmRequest: m.llmRequest, settings: settings, deps: deps,
                         locationAllowed: c.locationAllowed === undefined ? true : c.locationAllowed });
    if (c.deviceState) Object.assign(d.state, c.deviceState);
    var turns = c.turns || [{ say: c.say, expect: c.expect, forbid: c.forbid, text: c.text, notText: c.notText, effects: c.effects }];
    var rows = [];
    return turns.reduce(function (p, t, i) {
        return p.then(function (ok) {
            var t0 = Date.now();
            return d.askAll(t.say).then(function (msgs) {
                var ms = Date.now() - t0;
                var outs = outcomes(msgs);
                var e = t.expect || {};
                var allowed = allowedCommands(e);
                var forbidden = function (o) { return (t.forbid || []).indexOf(o.command) >= 0; };
                var unsafe = outs.filter(function (o) { return o.status === "done" && ((acts(o.command) && allowed.indexOf(o.command) < 0) || forbidden(o)); });
                var wrongReadBack = outs.filter(function (o) { return o.status === "pending" && (allowed.indexOf(o.command) < 0 || forbidden(o)); });
                var last = lastReply(msgs);
                var pass = expectOk(e, msgs, outs, !!opts.model) && !unsafe.length &&
                    (!t.text || new RegExp(t.text, "i").test(last ? last.text : "")) &&
                    (!t.notText || !new RegExp(t.notText, "i").test(msgs.filter(function (x) { return x.role === "assistant"; }).map(function (x) { return x.text; }).join(" "))) && effectsOk(t.effects, d);
                if (wrongReadBack.length && (!t.expect || !t.expect.command || !oneMatches(t.expect, outs) || wrongReadBack.some(forbidden))) pass = false;
                rows.push({ turn: i, say: t.say, pass: pass, ms: ms, unsafe: unsafe.map(function (o) { return o.command; }),
                            wrongReadBack: wrongReadBack.map(function (o) { return o.command; }),
                            got: outs, replies: msgs.filter(function (x) { return x.role === "assistant"; }).map(function (x) {
                                return { text: x.text, path: x.trace && x.trace.path, command: x.command || "", status: x.status || "", kind: x.kind || "",
                                         steps: x.trace && x.trace.steps }; }) });
                return ok && pass;
            });
        });
    }, Promise.resolve(true)).then(function (pass) {
        return { id: c.id, cat: c.cat, source: c.source || "", pass: pass, turns: rows };
    }, function (err) {
        return { id: c.id, cat: c.cat, source: c.source || "", pass: false, error: String(err && err.stack || err), turns: rows };
    });
}

function loadCases(file) {
    var all = JSON.parse(fs.readFileSync(file || CASES, "utf8"));
    var list = Array.isArray(all) ? all : all.cases;
    // The on-device model's set (apps/assistant/service/test/model-eval.json:
    // {text, command} the grammar did not take): its command, or no action for "none".
    if (list.length && list[0].text !== undefined && list[0].say === undefined) {
        return list.map(function (x, i) {
            return { id: "model-" + (i + 1), cat: x.command === "none" ? "questions and chat" : "commands", say: x.text,
                     expect: x.command === "none" ? { answer: ["chat", "knowledge", "fallback"] } : { command: x.command, status: ["done", "pending", "ask"] } };
        });
    }
    return list;
}

function run(opts) {
    opts = opts || {};
    var list = loadCases(opts.cases).filter(function (c) {
        return (!opts.cats || opts.cats.indexOf(c.cat) >= 0 || (opts.cats.indexOf("owner") >= 0 && c.source === "owner")) && (!opts.id || c.id === opts.id);
    });
    var results = [];
    return list.reduce(function (p, c) {
        return p.then(function () {
            return runCase(c, opts).then(function (r) {
                results.push(r);
                if (opts.progress) opts.progress(r, results.length, list.length);
            });
        });
    }, Promise.resolve()).then(function () { return summarize(results); });
}

function percentile(list, q) {
    if (!list.length) return 0;
    var s = list.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
function summarize(results) {
    var cats = {}, ms = [];
    function add(key, r) {
        var c = cats[key] || (cats[key] = { cases: 0, pass: 0, unsafe: 0, wrongReadBack: 0 });
        c.cases++;
        if (r.pass) c.pass++;
        if (r.turns.some(function (t) { return t.unsafe.length; })) c.unsafe++;
        if (r.turns.some(function (t) { return t.wrongReadBack.length; })) c.wrongReadBack++;
    }
    results.forEach(function (r) {
        add(r.cat, r);
        if (r.source === "owner") add("(owner's logs)", r);
        add("(all)", r);
        r.turns.forEach(function (t) { ms.push(t.ms); });
    });
    return { cats: cats, results: results, latency: { turns: ms.length, mean: Math.round(ms.reduce(function (a, b) { return a + b; }, 0) / (ms.length || 1)),
                                                      p50: percentile(ms, 0.5), p90: percentile(ms, 0.9), max: percentile(ms, 1) } };
}

function table(sum, md) {
    var keys = Object.keys(sum.cats).sort(function (a, b) { return (a[0] === "(") - (b[0] === "(") || (a < b ? -1 : 1); });
    var lines = [];
    if (md) {
        lines.push("| Category | Cases | Right | % | Unsafe actions | Wrong read-backs |", "|---|---|---|---|---|---|");
        keys.forEach(function (k) { var c = sum.cats[k]; lines.push("| " + k + " | " + c.cases + " | " + c.pass + " | " + Math.round(100 * c.pass / c.cases) + " | " + c.unsafe + " | " + c.wrongReadBack + " |"); });
    } else {
        keys.forEach(function (k) {
            var c = sum.cats[k];
            lines.push((k + "                         ").slice(0, 24) + (c.pass + "/" + c.cases + "        ").slice(0, 10) +
                       (Math.round(100 * c.pass / c.cases) + "%    ").slice(0, 6) + "  unsafe " + c.unsafe + "  wrong read-backs " + c.wrongReadBack);
        });
    }
    lines.push((md ? "\n" : "") + "Latency per turn: mean " + sum.latency.mean + " ms, median " + sum.latency.p50 + " ms, 90th percentile " + sum.latency.p90 + " ms, slowest " + sum.latency.max + " ms (" + sum.latency.turns + " turns)");
    return lines.join("\n");
}

module.exports = { run: run, runCase: runCase, summarize: summarize, table: table, matches: matches, loadCases: loadCases, CASES: CASES };

if (require.main === module) {
    var argv = process.argv.slice(2), opts = { progress: null };
    for (var i = 0; i < argv.length; ++i) {
        var a = argv[i];
        if (a === "--model") opts.model = argv[++i];
        else if (a === "--decider") opts.decider = require(path.resolve(argv[++i]));
        else if (a === "--cat") opts.cats = argv[++i].split(",");
        else if (a === "--id") opts.id = argv[++i];
        else if (a === "--json") opts.json = argv[++i];
        else if (a === "--cases") opts.cases = argv[++i];
        else if (a === "--service") ++i;
        else if (a === "--md") opts.md = true;
        else if (a === "--verbose") opts.verbose = true;
        else { console.error("unknown argument: " + a); process.exit(2); }
    }
    if (opts.model) opts.progress = function (r, n, total) { process.stderr.write("\r" + n + "/" + total + " " + (r.pass ? "ok  " : "FAIL") + " " + r.id + "                    "); };
    run(opts).then(function (sum) {
        if (opts.model) process.stderr.write("\n");
        if (opts.verbose) {
            sum.results.filter(function (r) { return !r.pass; }).forEach(function (r) {
                console.log("FAIL " + r.id + " [" + r.cat + "]" + (r.error ? " " + r.error : ""));
                r.turns.forEach(function (t) {
                    console.log("   " + (t.pass ? "ok " : "-- ") + JSON.stringify(t.say) + " -> " + t.replies.map(function (x) {
                        return (x.command ? x.command + "/" + (x.status || "-") + " " : "") + "(" + x.path + ") " + JSON.stringify(String(x.text).slice(0, 110));
                    }).join(" | ") + (t.unsafe.length ? "  UNSAFE " + t.unsafe.join(",") : ""));
                    t.got.forEach(function (o) { console.log("        " + o.command + " " + JSON.stringify(o.args).slice(0, 200)); });
                });
            });
        }
        console.log(table(sum, opts.md));
        if (opts.decider && opts.decider.stats) console.log("Decision model: " + JSON.stringify(opts.decider.stats()));
        if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(sum, null, 1));
    }).catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
}
