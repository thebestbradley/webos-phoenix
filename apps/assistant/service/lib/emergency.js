// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Emergency numbers, for the Assistant's calls: the same lists as the
// Phone's emergency dialer (apps/shared/luna/src/setup.ts EMERGENCY_NUMBERS,
// NATIONAL_EMERGENCY_NUMBERS, primaryEmergencyNumber; 3GPP TS 22.101
// section 10.1.1: 112 and 911 always; 000, 08, 110, 999, 118 and 119
// without a SIM). The service runs as plain JavaScript on the device, so
// the lists are kept here too; emergency.test.ts checks they agree.
//
// A call to one is never refused or held for a yes: it is placed after a
// short countdown the user can cancel (COUNTDOWN_S), as Siri and Google
// Assistant do, and it may be asked for over the lock screen.
//
//   isEmergency(number, country) -> boolean
//   primary(country) -> "911" | "112" | ...
//   countryOf(locale) -> "us" (from "en-US"), "" when none

"use strict";

var NUMBERS = ["112", "911", "000", "08", "110", "118", "119", "999"];
var NATIONAL = {
    nz: ["111"],
    in: ["100", "101", "102", "108"],
    fr: ["15", "17", "18", "115"],
    it: ["113", "115"],
    es: ["061", "062", "080", "091", "092"],
    br: ["190", "192", "193"],
    cn: ["120", "122"],
    kr: ["112", "119"],
    mx: ["065", "066"],
    za: ["10111", "10177"],
    ch: ["117", "144"],
    at: ["122", "133", "144"]
};
// The seconds before the call is placed (Siri and Google Assistant count
// down about five).
var COUNTDOWN_S = 5;

function isEmergency(number, country) {
    var raw = String(number || ""), n = raw.replace(/[^0-9]/g, "");
    if (!n || n !== raw.replace(/[\s\-().]/g, "")) return false;
    return NUMBERS.indexOf(n) >= 0 || (NATIONAL[String(country || "").toLowerCase()] || []).indexOf(n) >= 0;
}
function primary(country) {
    var c = String(country || "").toLowerCase();
    if (["us", "ca", "mx", "pr"].indexOf(c) >= 0) return "911";
    if (["gb", "ie", "hk", "sg", "my"].indexOf(c) >= 0) return "999";
    if (c === "au") return "000";
    if (c === "nz") return "111";
    if (["jp", "tw"].indexOf(c) >= 0) return "110";
    return "112";
}
function countryOf(locale) {
    var m = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(String(locale || ""));
    return m ? m[1].toLowerCase() : "";
}

module.exports = { isEmergency: isEmergency, primary: primary, countryOf: countryOf, NUMBERS: NUMBERS, NATIONAL: NATIONAL, COUNTDOWN_S: COUNTDOWN_S };
