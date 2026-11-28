// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device's language and region for the shell, and its dates and times
// in that locale's formats.
//
// The device's locale is the system setting localeInfo {locales: {UI, FMT},
// clock, timezone}: UI the language ("de-DE"), FMT the region whose formats
// dates, times and numbers take. luna-sysmgr read it from
// com.palm.systemservice getPreferences {keys: ["localeInfo"], subscribe}
// (luna-sysmgr-common Src/base/settings/LocalePreferences.cpp:404-407,
// getLocaleInfoCallback :550-651) and made UI Qt's default locale
// (QLocale::setDefault, :299 and :602); webOS OSE keeps it in
// com.webos.settingsservice (luna-surfacemanager's SystemSettings.qml
// subscribes there), where Phoenix's Settings > Language & Region and First
// Use write it. Without one: en-US (s_defaultLocale "en_us",
// LocalePreferences.cpp:36).
//
// The formats are the locale's own (Qt's CLDR data), never the host's: the
// status bar's short date is the locale's short date
// (StatusBarClock.cpp:223, Qt::DefaultLocaleShortDate); the clock is 12 h
// without a leading zero or 24 h as the timeFormat preference says
// (StatusBarClock::tick :195-210, ClockWindow::tick :133-145, timeFormat
// from LocalePreferences.cpp:527-533), in the locale's separator and digits.

.pragma library

var DEFAULT_TAG = "en-US";

// A tag in either form ("de-DE", "de_de", "zh-Hant-TW"): {language, script,
// region}, or null. As the runtime's localeParts (phoenix-runtime.js).
function parts(tag) {
    var list = String(tag || "").replace(/_/g, "-").split("-");
    var language = (list.shift() || "").toLowerCase();
    if (!/^[a-z]{2,3}$/.test(language))
        return null;
    var out = { language: language, script: "", region: "" };
    list.forEach(function(x) {
        if (!out.script && !out.region && /^[A-Za-z]{4}$/.test(x))
            out.script = x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
        else if (!out.region && /^([A-Za-z]{2}|[0-9]{3})$/.test(x))
            out.region = x.toUpperCase();
    });
    return out;
}

// The BCP 47 tag ("de-DE"), or "" for something that is not one.
function tag(t) {
    var p = parts(t);
    return p ? p.language + (p.script ? "-" + p.script : "") + (p.region ? "-" + p.region : "") : "";
}

// Qt's name for it ("de_DE"), for Qt.locale() and the translator.
function qtName(t) {
    var p = parts(t);
    if (!p)
        p = parts(DEFAULT_TAG);
    return p.language + (p.script ? "_" + p.script : "") + (p.region ? "_" + p.region : "");
}

// localeInfo's language: locales.UI, else en-US.
function uiTag(info) {
    var l = info && info.locales;
    return tag(l && l.UI) || DEFAULT_TAG;
}

// The locale dates and times are written in: locales.FMT (the region
// Settings > Language & Region picks, whose formats it shows), else UI.
function formatTag(info) {
    var l = info && info.locales;
    return tag(l && l.FMT) || uiTag(info);
}

// Right to left: the languages written in a right-to-left script, or the
// script the tag names (the runtime's localeDirection; luna-surfacemanager's
// SystemSettings.qml l10n.isRTL takes he, ar, ur, ku and fa).
function isRightToLeft(t) {
    var p = parts(t);
    if (!p)
        return false;
    if (p.script)
        return /^(Arab|Hebr|Thaa|Syrc|Nkoo|Adlm|Rohg|Mand|Samr|Mend|Yezi)$/.test(p.script);
    return /^(ar|he|iw|fa|ur|ps|yi|ji|ckb|sd|ug|dv)$/.test(p.language);
}

// Qt's Locale for a tag.
function locale(t) {
    return Qt.locale(qtName(t));
}

// The locale's short time format as a clock: the seconds left out, the
// hour 12 h without a leading zero ("h", as StatusBarClock::tick dropped
// the '0' of "%I") or 24 h (the locale's own "H" or "HH", else "HH" as
// "%H"). 12 h keeps an AM/PM marker ("AP": Qt counts "h" in 12 h only
// beside one); clock() takes its text out again.
function clockFormat(t, twentyFourHour) {
    var f = locale(t).timeFormat(1 /* Locale.ShortFormat */);
    // The marker, with the space or narrow space beside it.
    f = f.replace(/\s*\b[aA][pP]?\b\s*/g, " ").replace(/[:.]?ss/g, "").trim();
    var twelve = /h/.test(f);
    if (twentyFourHour)
        return twelve ? f.replace(/h+/, "HH") : f;
    return f.replace(/H+|h+/, "h") + " AP";
}

// The European digits for a string in another script's (Arabic-Indic,
// Persian, Devanagari, ...): the lock screen's clock is pictures of 0-9.
function latinDigits(s) {
    return String(s).replace(/[٠-٩۰-۹०-९০-৯๐-๙０-９]/g, function(c) {
        var code = c.charCodeAt(0);
        var zeros = [0x0660, 0x06F0, 0x0966, 0x09E6, 0x0E50, 0xFF10];
        for (var i = 0; i < zeros.length; ++i)
            if (code >= zeros[i] && code <= zeros[i] + 9)
                return String(code - zeros[i]);
        return c;
    }).replace(/[‎‏؜]/g, "");
}

// The clock: "9:41" (12 h), "21:41" (24 h); "21.41" in Finnish, "٩:٤١" in
// Arabic.
function clock(date, t, twentyFourHour) {
    var l = locale(t);
    var text = date.toLocaleTimeString(l, clockFormat(t, twentyFourHour));
    if (twentyFourHour)
        return text;
    // The marker the status bar and lock screen never showed.
    var marker = date.getHours() < 12 ? l.amText : l.pmText;
    var at = marker ? text.lastIndexOf(marker) : -1;
    if (at >= 0)
        text = text.slice(0, at) + text.slice(at + marker.length);
    return text.replace(/[\s\u200E\u200F\u061C]+$/, "").replace(/^[\s\u200E\u200F\u061C]+/, "");
}

// The locale's short date (StatusBarClock::tick on the lock screen,
// Qt::DefaultLocaleShortDate): "6/6/09", "06.06.09".
function shortDate(date, t) {
    var l = locale(t);
    return date.toLocaleDateString(l, l.dateFormat(1 /* Locale.ShortFormat */));
}

// The locale's long date (the system menu's DateElement):
// "Saturday, June 6, 2009", "Samstag, 6. Juni 2009".
function longDate(date, t) {
    var l = locale(t);
    return date.toLocaleDateString(l, l.dateFormat(0 /* Locale.LongFormat */));
}

// A long date format without its year: the year and the words or marks
// that went with it ("dddd, MMMM d, yyyy" -> "dddd, MMMM d";
// "dddd, d 'de' MMMM 'de' yyyy" -> "dddd, d 'de' MMMM";
// "yyyy年M月d日dddd" -> "M月d日dddd").
function withoutYear(f) {
    var out = String(f)
        .replace(/^y+\s*[年년]?\s*/, "")
        .replace(/[\s,،.\/\-]*('[^']*'\s*)?y+\s*[年년]?\.?\s*$/, "")
        .replace(/[\s,،]*y+\s*[年년]?/, "");
    return out.trim();
}

// The weekday, month and day (the lock screen's date under the clock):
// "Saturday, June 6", "Samstag, 6. Juni", "6月6日土曜日".
function dayAndMonth(date, t) {
    var l = locale(t);
    return date.toLocaleDateString(l, withoutYear(l.dateFormat(0 /* Locale.LongFormat */)));
}
