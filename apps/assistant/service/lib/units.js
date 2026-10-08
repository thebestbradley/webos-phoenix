// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Unit conversions for the Phoenix Assistant's "convert" command, offline:
// each unit is a kind and its size in the kind's base unit (SI). The words
// for units are in the language files (lib/lang/<code>.js UNIT_WORDS);
// currencies are ISO 4217 codes and convert with the day's rates
// (lib/commands.js, Frankfurter: the European Central Bank's reference
// rates), so they need the network.

"use strict";

var UNITS = {
    // length, metres
    mm: ["length", 0.001], cm: ["length", 0.01], m: ["length", 1], km: ["length", 1000],
    in: ["length", 0.0254], ft: ["length", 0.3048], yd: ["length", 0.9144], mi: ["length", 1609.344], nmi: ["length", 1852],
    // mass, kilograms
    mg: ["mass", 1e-6], g: ["mass", 0.001], kg: ["mass", 1], t: ["mass", 1000],
    oz: ["mass", 0.028349523125], lb: ["mass", 0.45359237], st: ["mass", 6.35029318],
    // volume, litres (US customary measures)
    ml: ["volume", 0.001], cl: ["volume", 0.01], dl: ["volume", 0.1], l: ["volume", 1], m3: ["volume", 1000],
    tsp: ["volume", 0.00492892159375], tbsp: ["volume", 0.01478676478125], floz: ["volume", 0.0295735295625],
    cup: ["volume", 0.2365882365], pt: ["volume", 0.473176473], qt: ["volume", 0.946352946], gal: ["volume", 3.785411784],
    // area, square metres
    m2: ["area", 1], km2: ["area", 1e6], ft2: ["area", 0.09290304], ha: ["area", 1e4], acre: ["area", 4046.8564224], mi2: ["area", 2589988.110336],
    // speed, metres per second
    kmh: ["speed", 1000 / 3600], mph: ["speed", 0.44704], ms: ["speed", 1], kn: ["speed", 1852 / 3600],
    // time, seconds
    sec: ["time", 1], min: ["time", 60], h: ["time", 3600], day: ["time", 86400], wk: ["time", 604800],
    // data, bytes (decimal, as storage is sold)
    b: ["data", 1], kb: ["data", 1e3], mb: ["data", 1e6], gb: ["data", 1e9], tb: ["data", 1e12],
    // temperature: by formula below
    c: ["temperature", 0], f: ["temperature", 0], k: ["temperature", 0]
};

function toBase(v, u) {
    if (u === "c") return v;
    if (u === "f") return (v - 32) * 5 / 9;
    if (u === "k") return v - 273.15;
    return v * UNITS[u][1];
}
function fromBase(v, u) {
    if (u === "c") return v;
    if (u === "f") return v * 9 / 5 + 32;
    if (u === "k") return v + 273.15;
    return v / UNITS[u][1];
}

// value in `from` as `to`; null when the two are not the same kind of thing.
function convert(value, from, to) {
    if (!UNITS[from] || !UNITS[to] || UNITS[from][0] !== UNITS[to][0]) return null;
    return fromBase(toBase(Number(value), from), to);
}
function kind(u) { return UNITS[u] ? UNITS[u][0] : null; }

// A number as said back: up to 4 significant figures, no float noise.
function round(v) {
    if (!isFinite(v)) return String(v);
    var a = Math.abs(v);
    var digits = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 4;
    var s = v.toFixed(digits);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s === "-0" ? "0" : s;
}

var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD", "SGD", "INR", "KRW", "SEK", "NOK", "DKK",
                  "PLN", "CZK", "HUF", "MXN", "BRL", "ZAR", "TRY", "ILS", "THB", "IDR", "PHP", "MYR", "RON", "ISK", "BGN"];

module.exports = { UNITS: UNITS, convert: convert, kind: kind, round: round, CURRENCIES: CURRENCIES };
