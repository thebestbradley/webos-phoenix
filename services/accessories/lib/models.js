// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// AirPods by model number (what an AAP session's version information
// gives, aap.js): the name and what each can do.
//
//   Model numbers: Apple's support article "Identify your AirPods"
//   (support.apple.com/en-us/109525), as of October 2026.
//   Listening modes: Apple's AirPods User Guide, "Switch between listening
//   modes on AirPods": Noise Cancellation and Transparency on AirPods Pro,
//   AirPods 4 (ANC), AirPods 5 and AirPods Max; Adaptive on AirPods 4
//   (ANC), AirPods 5, AirPods Pro 2, AirPods Pro 3 and AirPods Max 2.
//   Conversation Awareness: Apple's footnotes name AirPods Pro 2 and
//   AirPods 4 (ANC); Phoenix offers it where Adaptive is.
//   Automatic ear detection: every AirPods with earbuds (AirPods Max detect
//   the head instead; the same switch).

"use strict";

var ANC = ["off", "transparency", "anc"];
var ADAPTIVE = ["off", "transparency", "adaptive", "anc"];

var LIST = [
    { name: "AirPods 5", kind: "airpods", numbers: ["A3531", "A3532", "A3533", "A3439", "A3440", "A3441"], modes: ADAPTIVE, ca: true },
    { name: "AirPods 4 (ANC)", kind: "airpods", numbers: ["A3056", "A3055", "A3057"], modes: ADAPTIVE, ca: true },
    { name: "AirPods 4", kind: "airpods", numbers: ["A3053", "A3050", "A3054"], modes: [], ca: false },
    { name: "AirPods Pro 3", kind: "airpodspro", numbers: ["A3063", "A3064", "A3065"], modes: ADAPTIVE, ca: true },
    { name: "AirPods Pro 2", kind: "airpodspro", numbers: ["A3047", "A3048", "A3049", "A2931", "A2699", "A2698"], modes: ADAPTIVE, ca: true },
    { name: "AirPods 3", kind: "airpods", numbers: ["A2565", "A2564"], modes: [], ca: false },
    { name: "AirPods Max 2", kind: "airpodsmax", numbers: ["A3454"], modes: ADAPTIVE, ca: true },
    { name: "AirPods Max", kind: "airpodsmax", numbers: ["A3184", "A2096"], modes: ANC, ca: false },
    { name: "AirPods Pro", kind: "airpodspro", numbers: ["A2084", "A2083"], modes: ANC, ca: false },
    { name: "AirPods 2", kind: "airpods", numbers: ["A2032", "A2031"], modes: [], ca: false },
    { name: "AirPods", kind: "airpods", numbers: ["A1523", "A1722"], modes: [], ca: false }
];

// {name, kind, modes, conversationAwareness} for a model number, or null.
function byNumber(number) {
    var n = String(number || "").trim().toUpperCase();
    for (var i = 0; i < LIST.length; ++i)
        if (LIST[i].numbers.indexOf(n) >= 0)
            return { name: LIST[i].name, kind: LIST[i].kind, modes: LIST[i].modes.slice(), conversationAwareness: LIST[i].ca };
    return null;
}

// What a device can do before its model number is known: by its
// Proximity Pairing kind (continuity.js MODELS) or its name.
function guess(kind, name) {
    var n = String(name || "");
    if (kind === "airpodspro" || /airpods pro/i.test(n)) return { modes: ANC.slice(), conversationAwareness: false };
    if (kind === "airpodsmax" || /airpods max/i.test(n)) return { modes: ANC.slice(), conversationAwareness: false };
    return { modes: [], conversationAwareness: false };
}

module.exports = { byNumber: byNumber, guess: guess, LIST: LIST };
