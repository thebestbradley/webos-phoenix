// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sums for the assistant's "calculate" command: + - * / ^, brackets, sqrt,
// and percent ("15% * 80" is 15% of 80; "80 + 15%" adds 15% of 80, as a
// calculator's percent key does). A small recursive-descent parser: no
// eval, nothing but numbers comes out.

"use strict";

function tokenize(text) {
    var out = [], re = /\s*(\d+(?:\.\d+)?|\.\d+|sqrt|[-+*/^()%])/y, m, pos = 0, s = String(text);
    re.lastIndex = 0;
    while (pos < s.length) {
        if (/^\s*$/.test(s.slice(pos))) break;
        re.lastIndex = pos;
        m = re.exec(s);
        if (!m) throw new Error("bad expression");
        out.push(m[1]);
        pos = re.lastIndex;
    }
    return out;
}

function evaluate(text) {
    var toks = tokenize(text), i = 0;
    function peek() { return toks[i]; }
    function next() { return toks[i++]; }
    // expr := term (('+'|'-') term)*   with "a + b%" = a + a*b/100
    function expr() {
        var v = term();
        while (peek() === "+" || peek() === "-") {
            var op = next(), r = term(true);
            var rv = r.percent ? v * r.value / 100 : r.value;
            v = op === "+" ? v + rv : v - rv;
        }
        return v;
    }
    // term := power (('*'|'/') power)*
    function term(keepPercent) {
        var f = power(), v = f.value, percent = f.percent;
        while (peek() === "*" || peek() === "/") {
            var op = next(), r = power();
            var rv = r.percent ? r.value / 100 : r.value;
            if (percent) { v = v / 100; percent = false; }
            if (op === "/" && rv === 0) throw new Error("division by zero");
            v = op === "*" ? v * rv : v / rv;
        }
        if (keepPercent) return { value: v, percent: percent };
        return percent ? v / 100 : v;
    }
    // power := unary ('^' power)?   then an optional '%'
    function power() {
        var u = unary();
        if (peek() === "^") { next(); var e = power(); u = Math.pow(u, e.percent ? e.value / 100 : e.value); }
        var percent = false;
        if (peek() === "%") { next(); percent = true; }
        return { value: u, percent: percent };
    }
    function unary() {
        if (peek() === "-") { next(); return -unary(); }
        if (peek() === "+") { next(); return unary(); }
        if (peek() === "sqrt") {
            next();
            var x = unary();
            if (x < 0) throw new Error("square root of a negative number");
            return Math.sqrt(x);
        }
        if (peek() === "(") {
            next();
            var v = expr();
            if (next() !== ")") throw new Error("missing )");
            return v;
        }
        var t = next();
        if (t === undefined || !/^[\d.]/.test(t)) throw new Error("bad expression");
        return Number(t);
    }
    var v = expr();
    if (i < toks.length) throw new Error("bad expression");
    if (!isFinite(v)) throw new Error("no answer");
    return v;
}

// 12, 0.333333, 1234567.5: at most 10 significant digits, no trailing zeros.
function format(v) {
    if (Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-6)) return v.toExponential(6).replace(/\.?0+e/, "e");
    var s = Number(v.toPrecision(10)).toString();
    return s;
}

// How the sum reads back: "15% × 80".
function pretty(expr) {
    return String(expr).replace(/\s+/g, " ").replace(/\*/g, "×").replace(/\//g, "÷").replace(/sqrt\s*/g, "√").trim();
}

module.exports = { evaluate: evaluate, format: format, pretty: pretty };
