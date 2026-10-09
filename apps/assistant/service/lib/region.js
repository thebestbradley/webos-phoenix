// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device's units for the Assistant's answers, as every app reads
// them (apps/shared/luna/src/units.ts, which this repeats; its test checks
// that the two agree): com.webos.settingsservice's {measurementUnits:
// "auto" | "metric" | "imperial"} (Settings > Language & Region > Units),
// "auto" following the region (localeInfo FMT, else UI): miles and °F in
// the United States and the few others that use them.

"use strict";

var IMPERIAL_REGIONS = ["US", "PR", "GU", "VI", "AS", "MP", "UM", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"];

function regionOf(locale) {
    var m = /^[a-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2}|\d{3})\b/.exec(String(locale || ""));
    return m ? m[1].toUpperCase() : "";
}
function systemFor(setting, locale) {
    if (setting === "metric" || setting === "imperial") return setting;
    return IMPERIAL_REGIONS.indexOf(regionOf(locale)) >= 0 ? "imperial" : "metric";
}
// s: the settings service's {localeInfo, measurementUnits}.
function deviceUnits(s, fallbackLocale) {
    s = s || {};
    var loc = (s.localeInfo && s.localeInfo.locales) || {};
    return systemFor(s.measurementUnits, loc.FMT || loc.UI || fallbackLocale || "en-US");
}

module.exports = { IMPERIAL_REGIONS: IMPERIAL_REGIONS, regionOf: regionOf, systemFor: systemFor, deviceUnits: deviceUnits };
