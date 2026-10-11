// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for EmbeddingGemma 2 in tests and the Assistant's evaluation
// (apps/assistant/service/test/device.cjs): deterministic, instant, and
// with a little meaning. Each word counts as its concept (CONCEPTS: a
// furnace and a boiler are both "heating"), hashed into 256 dimensions with
// a sign, summed and normalized, so a passage scores high for a query that
// shares its concepts even when it shares no word. The same methods as
// lib/embedder.js; calls counts them (what was embedded, for the tests).

"use strict";

var CONCEPTS = {
    heating: ["boiler", "furnace", "heating", "heater", "radiator", "radiators", "thermostat", "warm", "heat"],
    repair: ["plumber", "repair", "fix", "fixed", "engineer", "technician", "service", "serviced", "maintenance", "broken", "leak", "leaking"],
    network: ["wifi", "wi-fi", "internet", "network", "router", "broadband", "lakeview", "ssid"],
    secret: ["password", "passcode", "passphrase", "pin", "login"],
    celebration: ["party", "birthday", "celebration", "bash", "cake", "surprise", "anniversary"],
    seaside: ["beach", "sea", "ocean", "dunes", "dune", "coast", "coastal", "shore", "sand", "seaside", "waves"],
    mountain: ["mountain", "mountains", "alpine", "peak", "summit", "hike", "hiking", "trail"],
    food: ["lunch", "dinner", "eat", "eating", "restaurant", "bistro", "food", "meal", "table"],
    travel: ["trip", "flight", "travel", "vacation", "holiday", "hotel", "booking", "itinerary"],
    money: ["invoice", "bill", "payment", "receipt", "budget", "cost", "price", "paid"],
    doctor: ["dentist", "doctor", "clinic", "appointment", "checkup", "dental"],
    car: ["car", "parking", "parked", "garage", "vehicle", "mechanic"],
    books: ["book", "books", "read", "reading", "novel", "library"],
    late: ["late", "delayed", "running", "minutes", "eta"]
};
var BY_WORD = {};
Object.keys(CONCEPTS).forEach(function (c) { CONCEPTS[c].forEach(function (w) { BY_WORD[w] = c; }); });
var STOP = /^(?:the|a|an|and|or|of|to|in|on|at|for|with|from|is|are|was|were|it|this|that|my|me|i|you|we|our|your|be|by|as|if|so|do|did|about|what|where|when|which|who|how|title|text|none|task|search|result|query|find|show|any|note|memo|email|message|photo|photos|picture|say|said)$/;
var DIM = 256;

function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; ++i) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h;
}
function tokens(text) {
    return String(text || "").toLowerCase().replace(/wi-fi/g, "wifi").split(/[^a-z0-9]+/).filter(function (w) { return w && !STOP.test(w); });
}
function embed(text) {
    var v = new Float32Array(DIM);
    tokens(text).forEach(function (w) {
        var key = BY_WORD[w] || BY_WORD[w.replace(/s$/, "")] || w.replace(/s$/, "");
        var concept = !!(BY_WORD[w] || BY_WORD[w.replace(/s$/, "")]);
        for (var k = 0; k < 3; ++k) {
            var h = fnv(key + "#" + k);
            // The high bits: FNV-1a's low byte depends on the low byte alone.
            v[(h >>> 16) % DIM] += (h & 0x100 ? 1 : -1) * (concept ? 2 : 1);
        }
    });
    var n = 0, i;
    for (i = 0; i < DIM; ++i) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    for (i = 0; i < DIM; ++i) v[i] /= n;
    return v;
}

function createFakeEmbedder() {
    var calls = { documents: 0, inputs: 0, queries: 0, media: 0 };
    return {
        calls: calls,
        documents: function (texts) { calls.documents++; calls.inputs += texts.length; return Promise.resolve(texts.map(embed)); },
        query: function (q) { calls.queries++; return Promise.resolve(embed(q)); },
        // A picture or recording: its bytes' text, as the tests write them ("beach waves").
        media: function (list) {
            calls.media += list.length;
            return Promise.resolve(list.map(function (x) { return embed(Buffer.from(x.base64, "base64").toString("latin1")); }));
        },
        forget: function () {}
    };
}

module.exports = { createFakeEmbedder: createFakeEmbedder, embed: embed, CONCEPTS: CONCEPTS };
