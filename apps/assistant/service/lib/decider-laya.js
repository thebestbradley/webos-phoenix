// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The decision model between the grammar and the general model
// (docs/AI-AND-MCP.md "A decision model: Laya"): Convai Innovations' Laya
// (Apache-2.0, ModernBERT-large, 421M), which answers typed questions
// about a state ("which of these?", "yes or no?") with calibrated
// probabilities in one forward pass, writing no words.
//
// It is asked one multiple choice: which of the complete requests the
// service found the words close to ("Turn bluetooth off", "Turn bluetooth
// on", "Is bluetooth on"; assistant.js decisionOptions), or "something
// else" (another request, a question, chat: the general model's), or
// "none of these" (unclear: the user is asked). Every option is a whole,
// valid command, so whatever it picks can be done; how sure it is decides
// whether it is done, read back, or passed on (the router's thresholds).
// (The first design asked it, zero-shot, for a kind of request among ten
// descriptions and then a command among the kind's: its weakest use, and
// measured no better than nothing: docs/AI-AND-MCP.md.)
//
// createLayaDecider({predict(state, questions) -> Promise<{answers}>,
//   threshold, readBackAt}) -> the router's deps.decider:
//   decide({text, history, last, options: [label], now}) ->
//     Promise<{choice: index | "else" | "none", confidence, ranked} | null>
//   yesNo(text, question) -> Promise<"yes" | "no" | null>
// predict is Laya's own call shape (laya Agent.predict, laya-serve's
// /v1/systemone); tools/decider-laya.cjs asks a laya-server for the evaluation.

"use strict";

var ELSE = "Something else: another request, a question, or chat";
var NONE = "None of these: unclear, ask what they mean";

function sorted(probs) {
    return Object.keys(probs || {}).map(function (k) { return [k, probs[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
}
function choiceOf(a) {
    var p = sorted(a && a.probabilities);
    return p.length ? { value: p[0][0], p: p[0][1], ranked: p } : a && a.choice !== undefined ? { value: a.choice, p: a.confidence || 0, ranked: [[a.choice, a.confidence || 0]] } : null;
}

// The state Laya reads: the request, and the turn before it when there is one.
function stateOf(input) {
    var s = { request: String(input.text || "") };
    var before = (input.history || []).slice(-3, -1).map(function (m) { return (m.role === "user" ? "user: " : "assistant: ") + m.text; });
    if (before.length) s.before = before.join(" | ");
    return s;
}
// The question: the options as o0..o7 (eight at most, with the two others
// ten: Laya's calibration holds to ten options).
function questionOf(options) {
    var criteria = {};
    options.slice(0, 8).forEach(function (o, i) { criteria["o" + i] = o; });
    criteria["else"] = ELSE;
    criteria.none = NONE;
    return { pick: { type: "choice", instructions: "Which of these does the user ask their phone's assistant to do?", criteria: criteria } };
}
function answerOf(r) {
    var c = choiceOf(r && r.answers && r.answers.pick);
    if (!c) return null;
    var key = function (k) { return /^o\d+$/.test(k) ? Number(k.slice(1)) : k; };
    return { choice: key(c.value), confidence: c.p, ranked: c.ranked.map(function (x) { return [key(x[0]), x[1]]; }) };
}

function createLayaDecider(opts) {
    var predict = opts.predict, threshold = opts.threshold || 0.9;
    return {
        name: "Laya",
        threshold: threshold,
        readBackAt: opts.readBackAt || threshold,
        decide: function (input) {
            var options = input.options || [];
            if (!options.length) return Promise.resolve(null);
            return predict(stateOf(input), questionOf(options)).then(answerOf);
        },
        // An answer to a read-back ("Send it?") the words do not say plainly ("go for it", "nah, leave it").
        yesNo: function (text, question) {
            return predict({ question: String(question || ""), answer: String(text || "") },
                           { agree: { type: "choice", instructions: "Does the answer agree to the question?", criteria: { yes: "yes, agrees, go ahead", no: "no, refuses, cancel", other: "neither: something else" } } })
                .then(function (r) {
                    var c = choiceOf(r.answers && r.answers.agree);
                    return c && c.value !== "other" && c.p >= threshold ? c.value : null;
                });
        }
    };
}

module.exports = { createLayaDecider: createLayaDecider, stateOf: stateOf, questionOf: questionOf, answerOf: answerOf, ELSE: ELSE, NONE: NONE };
